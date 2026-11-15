// Additive, repeatable multi-project samples for the dedicated local review database.
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
config({ path: ".env.local", quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw Error("LOCAL_DATABASE_REQUIRED");
url.pathname = "/agilecampus_test_documents_api_20261112";
process.env.DATABASE_URL = url.toString();
const { createDocumentService } = await import("../lib/documents/service.ts");
const client = postgres(url.toString(), { max: 1 });
try {
  const summary = await drizzle(client).transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(177002,3112)`);
    const [actor] = await tx.execute(sql`SELECT id FROM users WHERE email='document-review@example.test'`);
    if (!actor) throw Error("请先运行 node scripts/dev-documents.mjs --prepare-only");
    const [team] = await tx.execute(sql`SELECT id FROM teams WHERE owner_id=${actor.id} AND name='文档系统审查团队' ORDER BY id LIMIT 1`);
    if (!team) throw Error("REVIEW_TEAM_REQUIRED");
    const [original] = await tx.execute(sql`SELECT id,name FROM projects WHERE team_id=${team.id} AND key='DOCREVIEW'`);
    if (!original) throw Error("REVIEW_PROJECT_REQUIRED");
    let [second] = await tx.execute(sql`SELECT id,name FROM projects WHERE team_id=${team.id} AND key='DOCREVIEW2'`);
    if (!second) [second] = await tx.execute(sql`INSERT INTO projects(team_id,name,key) VALUES(${team.id},'校园活动平台（第二项目）','DOCREVIEW2') RETURNING id,name`);
    const service = createDocumentService(tx);
    const results = [];
    async function seed(kind, id, label, category, entries) {
      const { space } = await service.openSpace(actor.id, kind, id);
      let [folder] = await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space.id} AND parent_id IS NULL AND state='active' AND name=${category}`);
      if (!folder) folder = (await service.create(actor.id, space.id, { kind: "folder", name: category, parentId: null, requestId: randomUUID() })).node;
      let added = 0;
      for (const [name, description] of entries) {
        if ((await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space.id} AND parent_id=${folder.id} AND state='active' AND name=${name}`)).length) continue;
        const { node } = await service.create(actor.id, space.id, { kind: "document", name, parentId: folder.id, requestId: randomUUID() });
        const content = { type: "doc", content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: name }] },
          { type: "paragraph", content: [{ type: "text", text: `所属空间：${label}。这是隔离测试库中的合成审查资料。` }] },
          { type: "paragraph", content: [{ type: "text", text: description }] },
        ] };
        const json = JSON.stringify(content);
        await tx.execute(sql`UPDATE document_bodies SET content_json=${json}::jsonb,content_hash=${createHash("sha256").update(json).digest("hex")},updated_by=${actor.id} WHERE node_id=${node.id}`);
        added++;
      }
      results.push({ space: label, folder: category, added, documents: entries.map(e => e[0]) });
    }
    await seed("project", original.id, original.name, "多项目审查示例", [
      ["项目计划", "第一项目：建设敏捷协作与文档系统，重点验证目录、资料关联和版本管理。"],
      ["第一项目－需求说明", "成员需要按项目管理资料，并从任务、里程碑引用同一份内容。"],
      ["第一项目－会议纪要", "本次讨论：明确项目空间与团队公共空间的边界，避免名称相近造成误操作。"],
      ["第一项目－验收清单", "检查项目切换、标题搜索、关联已有资料及解除关联后原文保留。"],
    ]);
    await seed("project", second.id, second.name, "多项目审查示例", [
      ["项目计划", "第二项目：建设校园活动报名平台，涉及活动发布、报名与签到。与第一项目的同名文档是独立条目。"],
      ["第二项目－需求说明", "学生浏览活动并报名，组织者查看报名名单及签到情况。"],
      ["第二项目－会议纪要", "本次讨论：先完成活动列表与报名流程，再接入签到。"],
      ["第二项目－验收清单", "检查本项目只搜索本空间，任务选择器不能直接选择第一项目资料。"],
    ]);
    const { space: shared } = await service.openSpace(actor.id, "team", team.id);
    for (const [role, oldName, name] of [["default-documents", "项目文档", "团队规范"], ["default-records", "协作记录", "共享参考"], ["default-deliverables", "交付成果", "公共素材"]]) {
      const [node] = await tx.execute(sql`SELECT n.id,n.version::text FROM document_migration_roots r JOIN document_nodes n ON n.id=r.node_id WHERE r.space_id=${shared.id} AND r.role=${role} AND n.parent_id IS NULL AND n.state='active' AND n.name=${oldName}`);
      const conflict = await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${shared.id} AND parent_id IS NULL AND state='active' AND name=${name}`);
      if (node && !conflict.length) await service.rename(actor.id, node.id, { name, expectedVersion: node.version });
    }
    await seed("team", team.id, "文档系统审查团队／团队公共空间", "公共资料审查示例", [
      ["团队协作规范", "两个项目共同使用的协作约定；项目归档不应冻结团队公共资料。"],
      ["公共－会议记录格式参考", "通用记录要点：日期、参与成员、讨论事项、结论和下一步责任人。此处是示例正文，不是已实现的模板功能。"],
      ["公共－课程提交要求", "共享参考：提交说明文档、演示材料及验收记录。此内容仅为合成测试样例。"],
      ["项目计划", "公共区的同名资料：用于对比两个项目内同名文档。所属空间才决定身份，标题相同不会合并。"],
    ]);
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    return results;
  });
  console.log(JSON.stringify(summary, null, 2));
} finally { await client.end(); }
