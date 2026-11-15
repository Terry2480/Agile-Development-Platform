import {sql} from "drizzle-orm";
import {db} from "@/db";
import {DocumentError} from "./errors";
import {createDocumentService} from "./service";

type Database=typeof db;
export async function documentsEnabled(database:Pick<Database,"execute">=db){
  const [schema]=await database.execute<{ready:boolean}>(sql`SELECT to_regclass('public.document_migrations') IS NOT NULL AS ready`);
  return !!schema?.ready && !!(await database.execute(sql`SELECT key FROM document_migrations WHERE key='documents-api-cutover-v1'`)).length;
}
export type DeletionConfirmation={confirmPermanent:true;expectedActive:number;expectedTrashed:number};
export function createDocumentLifecycle(database:Database=db){
  async function scope(tx:Pick<Database,"execute">,actor:number,kind:"project"|"team",id:number){
    const [team]=await tx.execute<{id:number;name:string;role:string;project_name:string|null}>(kind==="project"
      ?sql`SELECT t.id,t.name,m.role,p.name AS project_name FROM projects p JOIN teams t ON t.id=p.team_id JOIN team_members m ON m.team_id=t.id AND m.user_id=${actor} WHERE p.id=${id}`
      :sql`SELECT t.id,t.name,m.role,NULL::text AS project_name FROM teams t JOIN team_members m ON m.team_id=t.id AND m.user_id=${actor} WHERE t.id=${id}`);
    if(!team || !(kind==="team"?["owner"]:["owner","admin"]).includes(team.role))throw new DocumentError(403,"FORBIDDEN","没有执行此操作的权限");
    // Same order as structural writes: team, project, space. Exclusive team lock
    // prevents membership changes and new uploads during the final confirmation.
    await tx.execute(sql`SELECT id FROM teams WHERE id=${team.id} FOR UPDATE`);
    if(kind==="project")await tx.execute(sql`SELECT id FROM projects WHERE id=${id} FOR UPDATE`);
    const membership=await tx.execute(sql`SELECT id FROM team_members WHERE team_id=${team.id} AND user_id=${actor} AND role IN (${kind==="team"?sql`'owner'`:sql`'owner','admin'`})`);
    if(!membership.length)throw new DocumentError(403,"FORBIDDEN","权限已变化，请刷新");
    const spaces=await tx.execute<{id:number}>(sql`SELECT id FROM document_spaces WHERE team_id=${team.id} ORDER BY id FOR UPDATE`);
    return {...team,spaces:spaces.map(s=>s.id)};
  }
  async function counts(tx:Pick<Database,"execute">,teamId:number,kind:"project"|"team",id:number){
    const [row]=await tx.execute<{active:number;trashed:number;projects:number}>(sql`SELECT
      (SELECT count(*)::int FROM document_nodes n JOIN document_spaces s ON s.id=n.space_id WHERE s.team_id=${teamId} ${kind==="project"?sql`AND s.project_id=${id}`:sql``} AND n.state='active') AS active,
      (SELECT count(*)::int FROM document_nodes n JOIN document_spaces s ON s.id=n.space_id WHERE s.team_id=${teamId} ${kind==="project"?sql`AND s.project_id=${id}`:sql``} AND n.state<>'active') AS trashed,
      (SELECT count(*)::int FROM projects WHERE team_id=${teamId}) AS projects`);
    const editing=await tx.execute(sql`SELECT n.id,n.name,coalesce(nullif(u.name,''),u.student_id,'团队成员') AS editor FROM document_edit_locks l JOIN document_nodes n ON n.id=l.node_id JOIN document_spaces s ON s.id=n.space_id LEFT JOIN users u ON u.id=l.user_id WHERE s.team_id=${teamId} ${kind==="project"?sql`AND s.project_id=${id}`:sql``} AND l.expires_at>clock_timestamp()`);
    return {...row,editing:[...editing]};
  }
  async function removeExports(tx:Pick<Database,"execute">,spaceId:number){
    await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) SELECT DISTINCT r.resource_id,clock_timestamp() FROM document_resource_refs r JOIN document_export_items i ON i.id=r.export_item_id JOIN document_exports e ON e.id=i.export_id WHERE e.space_id=${spaceId} ON CONFLICT DO NOTHING`);
    await tx.execute(sql`DELETE FROM document_exports WHERE space_id=${spaceId}`);
    // Artifacts with no remaining job are collected by the export orphan sweep.
  }
  return {
    async impact(actor:number,kind:"project"|"team",id:number){return database.transaction(async tx=>{const team=await scope(tx,actor,kind,id);return {...await counts(tx,team.id,kind,id),destination:kind==="project"?`${team.project_name}＋${new Date().toISOString().slice(0,10)}`:null};});},
    async remove(actor:number,kind:"project"|"team",id:number,confirmation:DeletionConfirmation){
      return database.transaction(async tx=>{
        const team=await scope(tx,actor,kind,id);const impact=await counts(tx,team.id,kind,id);
        if(!confirmation?.confirmPermanent)throw new DocumentError(400,"CONFIRM_REQUIRED","请核对资料影响后确认");
        if(impact.active!==confirmation.expectedActive || impact.trashed!==confirmation.expectedTrashed)throw new DocumentError(409,"SCOPE_CHANGED","资料数量已变化，请重新打开确认窗口");
        if(impact.editing.length)throw new DocumentError(409,"DOCUMENT_EDITING","仍有文档正在编辑，请结束编辑后再操作");
        if(kind==="team" && impact.projects)throw new DocumentError(409,"PROJECTS_REMAIN","请先逐一删除团队项目，项目资料会转存公共区；再解散团队");
        await tx.execute(sql`SELECT set_config('app.documents_migrating','on',true),set_config('app.documents_legacy_adapter','on',true)`);
        if(kind==="project"){
          const [source]=await tx.execute<{id:number}>(sql`SELECT id FROM document_spaces WHERE project_id=${id}`);
          let destination:number|null=null;
          if(source){
            const opened=await createDocumentService(tx as unknown as Database).openSpace(actor,"team",team.id);
            const target=opened.space.id;let name=`${team.project_name}＋${new Date().toISOString().slice(0,10)}`;const base=name;let suffix=1;
            while((await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${target} AND parent_id IS NULL AND state='active' AND normalized_name=${name.replace(/[A-Z]/g,c=>c.toLowerCase())}`)).length)name=`${base}（${++suffix}）`;
            const [folder]=await tx.execute<{id:number}>(sql`INSERT INTO document_nodes(space_id,kind,name,normalized_name,created_by,updated_by) VALUES(${target},'folder',${name},${name.replace(/[A-Z]/g,c=>c.toLowerCase())},${actor},${actor}) RETURNING id`);destination=folder.id;
            // Remove only this project's associations before moving its nodes.
            await tx.execute(sql`DELETE FROM document_associations WHERE task_id IN (SELECT id FROM tasks WHERE project_id=${id}) OR milestone_id IN (SELECT id FROM milestones WHERE project_id=${id})`);
            await removeExports(tx,source.id);
            await tx.execute(sql`UPDATE document_trash_batches SET space_id=${target} WHERE space_id=${source.id}`);
            await tx.execute(sql`UPDATE document_trash_items i SET original_space_id=${target},original_parent_id=CASE WHEN i.original_parent_id IS NULL THEN ${folder.id} ELSE i.original_parent_id END,original_path=${JSON.stringify([{id:folder.id,name}])}::jsonb||i.original_path FROM document_nodes n WHERE n.id=i.node_id AND n.space_id=${source.id}`);
            await tx.execute(sql`UPDATE document_nodes SET space_id=${target},parent_id=coalesce(parent_id,${folder.id}),system_role=NULL,version=version+1,updated_at=clock_timestamp() WHERE space_id=${source.id}`);
            await tx.execute(sql`DELETE FROM document_spaces WHERE id=${source.id}`);
          }
          await tx.execute(sql`DELETE FROM projects WHERE id=${id}`);
          return {ok:true,destinationNodeId:destination,transferred:impact.active,trashed:impact.trashed};
        }
        for(const spaceId of team.spaces){
          await removeExports(tx,spaceId);
          await tx.execute(sql`DELETE FROM document_associations WHERE node_id IN (SELECT id FROM document_nodes WHERE space_id=${spaceId})`);
          // Parent FK is RESTRICT: delete leaves before ancestors.
          const nodes=await tx.execute<{id:number}>(sql`WITH RECURSIVE tree AS (SELECT id,0 AS depth FROM document_nodes WHERE space_id=${spaceId} AND parent_id IS NULL UNION ALL SELECT n.id,t.depth+1 FROM document_nodes n JOIN tree t ON n.parent_id=t.id) SELECT id FROM tree ORDER BY depth DESC,id DESC`);
          for(const node of nodes)await tx.execute(sql`DELETE FROM document_nodes WHERE id=${node.id}`);
          await tx.execute(sql`DELETE FROM document_trash_batches WHERE space_id=${spaceId}`);
          await tx.execute(sql`DELETE FROM document_spaces WHERE id=${spaceId}`);
        }
        // Durable, FK-independent cleanup survives team deletion and disk errors.
        await tx.execute(sql`INSERT INTO file_cleanup(stored_name) SELECT stored_name FROM document_resources WHERE team_id=${team.id} ON CONFLICT DO NOTHING`);
        await tx.execute(sql`DELETE FROM document_image_grants WHERE resource_id IN (SELECT id FROM document_resources WHERE team_id=${team.id})`);
        await tx.execute(sql`DELETE FROM document_resources WHERE team_id=${team.id}`);
        await tx.execute(sql`DELETE FROM teams WHERE id=${team.id}`);
        return {ok:true,cleanupQueued:true};
      });
    },
  };
}
