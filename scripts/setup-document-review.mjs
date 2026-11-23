// Additive local acceptance setup. Never resets a database or changes .env.local.
import {config} from "dotenv";
import postgres from "postgres";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";
import {spawnSync} from "node:child_process";
import {randomBytes,scryptSync,randomUUID} from "node:crypto";
import {generateDrizzleJson,generateMigration} from "drizzle-kit/api";
import ts from "typescript";
config({path:".env.local",quiet:true});
if(!process.env.DATABASE_URL)throw Error("请先配置本机 PostgreSQL 的 DATABASE_URL");
const url=new URL(process.env.DATABASE_URL);
if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw Error("只允许本机数据库");
const schemaOnly=process.argv.includes("--schema-only");
const name=schemaOnly?"agilecampus_test_documents_bootstrap_20261115":"agilecampus_test_documents_api_20261112";
url.pathname="/postgres";const admin=postgres(url.toString(),{max:1,onnotice:()=>{}});
try{if(!(await admin`SELECT 1 FROM pg_database WHERE datname=${name}`).length)await admin.unsafe(`CREATE DATABASE ${name}`);}finally{await admin.end();}
url.pathname="/"+name;process.env.DATABASE_URL=url.toString();
const client=postgres(url.toString(),{max:1,onnotice:()=>{}});
try{
  const [tables]=await client`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`;
  if(!tables.n){
    const schema={};runInNewContext(ts.transpileModule(readFileSync(new URL("../db/schema.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:schema,require:createRequire(import.meta.url)});
    const core=Object.fromEntries(Object.entries(schema).filter(([key])=>!key.startsWith("document")));
    const statements=await generateMigration(generateDrizzleJson({}),generateDrizzleJson(core));
    await client.begin(async tx=>{for(const statement of statements)await tx.unsafe(statement);});
  }
  if(!(await client`SELECT to_regclass('public.users') AS table_name`)[0].table_name)throw Error("现有审查库缺少基础表；为保护数据未做重置，请维护者核对");
  await client.begin(async tx=>{
    await tx`CREATE OR REPLACE FUNCTION queue_deleted_attachment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO file_cleanup(stored_name) VALUES(OLD.stored_name) ON CONFLICT(stored_name) DO UPDATE SET not_before=LEAST(file_cleanup.not_before,now()); RETURN OLD; END $$`;
    await tx`CREATE OR REPLACE TRIGGER attachments_file_cleanup AFTER DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION queue_deleted_attachment()`;
  });
  const {migrateDocuments}=await import("../db/add-documents.ts");
  await migrateDocuments(client,{backfill:true,cutover:true});
}finally{await client.end();}
if(schemaOnly){console.log("Fresh schema bootstrap verified: "+name);}else{
function run(file,args=[]){const result=spawnSync(process.execPath,["--import","tsx",file,...args],{stdio:"inherit",env:process.env,windowsHide:true});if(result.status!==0)throw Error("准备失败："+file);}
run("scripts/dev-documents.mjs",["--prepare-only"]);
run("scripts/seed-document-review.mjs");
const seed=postgres(url.toString(),{max:1,onnotice:()=>{}});
try{
  const {drizzle}=await import("drizzle-orm/postgres-js");const {createDocumentService}=await import("../lib/documents/service.ts");
  await seed.begin(async tx=>{
    const [owner]=await tx`SELECT id FROM users WHERE email='document-review@example.test'`;
    const [team]=await tx`SELECT id FROM teams WHERE owner_id=${owner.id} AND name='文档系统审查团队' ORDER BY id LIMIT 1`;
    for(const [label,role] of [["admin","admin"],["member","member"],["outsider",null]]){
      const email=`document-${label}@example.test`;let [user]=await tx`SELECT id FROM users WHERE email=${email}`;
      if(!user){const salt=randomBytes(16).toString("hex");const hash=salt+":"+scryptSync("DocReview2026!",salt,64).toString("hex");[user]=await tx`INSERT INTO users(email,student_id,password_hash,name) VALUES(${email},${"doc-review-"+label},${hash},${"验收"+label}) RETURNING id`;}
      if(role)await tx`INSERT INTO team_members(team_id,user_id,role) VALUES(${team.id},${user.id},${role}) ON CONFLICT(team_id,user_id) DO NOTHING`;
      else{
        let [other]=await tx`SELECT id FROM teams WHERE owner_id=${user.id} AND name='验收外部团队' ORDER BY id LIMIT 1`;
        if(!other)[other]=await tx`INSERT INTO teams(name,owner_id) VALUES('验收外部团队',${user.id}) RETURNING id`;
        await tx`INSERT INTO team_members(team_id,user_id,role) VALUES(${other.id},${user.id},'owner') ON CONFLICT DO NOTHING`;
        if(!(await tx`SELECT id FROM projects WHERE team_id=${other.id} AND key='DOCOUT'`).length)await tx`INSERT INTO projects(team_id,name,key) VALUES(${other.id},'外部团队项目','DOCOUT')`;
      }
    }
    await tx`INSERT INTO project_members(project_id,user_id) SELECT p.id,m.user_id FROM projects p JOIN team_members m ON m.team_id=p.team_id WHERE p.team_id=${team.id} ON CONFLICT DO NOTHING`;
    for(const p of await tx`SELECT id FROM projects WHERE team_id=${team.id} AND key IN ('DOCREVIEW','DOCREVIEW2')`){
      if(!(await tx`SELECT id FROM tasks WHERE project_id=${p.id} AND title='文档验收任务'`).length)await tx`INSERT INTO tasks(project_id,number,title) SELECT ${p.id},coalesce(max(number),0)+1,'文档验收任务' FROM tasks WHERE project_id=${p.id}`;
      if(!(await tx`SELECT id FROM milestones WHERE project_id=${p.id} AND name='文档验收里程碑'`).length)await tx`INSERT INTO milestones(project_id,name,due_on) VALUES(${p.id},'文档验收里程碑','2026-12-15')`;
    }
  });
  {
    const tx=seed;
    // A fresh external space gives the outsider an actual document to test scope.
    const [outsider]=await tx`SELECT id FROM users WHERE email='document-outsider@example.test'`;const [otherProject]=await tx`SELECT p.id FROM projects p JOIN teams t ON t.id=p.team_id WHERE t.owner_id=${outsider.id} AND p.key='DOCOUT' ORDER BY p.id LIMIT 1`;
    const service=createDocumentService(drizzle(seed));const opened=await service.openSpace(outsider.id,"project",otherProject.id);
    const page=await service.list(outsider.id,opened.space.id,{parentId:null,q:"",sort:"name",limit:10,foldersOnly:true});
    if(!(await tx`SELECT id FROM document_nodes WHERE space_id=${opened.space.id} AND name='外部团队独立资料'`).length)await service.create(outsider.id,opened.space.id,{kind:"document",name:"外部团队独立资料",parentId:page.nodes[0].id,requestId:randomUUID()});
  }
}finally{await seed.end();}
console.log("验收环境就绪：负责人 document-review、管理员 document-admin、普通成员 document-member、外部成员 document-outsider，邮箱后缀均为 @example.test；新账号初始密码 DocReview2026!（不重置已有密码）。运行 npm run dev:documents。");

}
