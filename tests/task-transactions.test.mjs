import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
function moduleAt(path, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(source, { exports, process, Response, URL, console: { error() {} }, require: (name) => overrides[name] ?? require(name) });
  return exports;
}
const schema = moduleAt("../db/schema.ts");
const { users, teams, teamMembers, projects, tasks, labels, taskLabels, comments, activities, notifications } = schema;
test("task writes roll back on activity or notification failure", async () => {
 const client = postgres(process.env.DATABASE_URL, { max: 1 });
 const database = drizzle(client); const rollback = new Error("rollback fixtures");
 try {
 await assert.rejects(database.transaction(async (outer) => {
  const suffix = randomUUID();
  const [actor, recipient] = await outer.insert(users).values(["actor", "recipient"].map(name => ({ email: `${name}-${suffix}@example.test`, studentId: `${name}-${suffix}`, name, passwordHash: "test-only" }))).returning();
  const [team] = await outer.insert(teams).values({name:"任务事务测试",ownerId:actor.id}).returning();
  await outer.insert(teamMembers).values([actor,recipient].map(user=>({teamId:team.id,userId:user.id,role:user.id===actor.id?"owner":"member"})));
  const [project] = await outer.insert(projects).values({teamId:team.id,name:"事务测试",key:"TX"}).returning();
  const [label] = await outer.insert(labels).values({teamId:team.id,name:"测试"}).returning();
  function routes(failure) {
   const wrap = base => new Proxy(base,{get(target,property){
    if(property==="transaction") return callback=>target.transaction(tx=>callback(wrap(tx)));
    if(property==="insert") return table=>{ if(table===failure) throw new Error("injected failure"); return target.insert(table); };
    const value=target[property];return typeof value==="function"?value.bind(target):value;
   }});
   const db=wrap(outer);
   const common={"@/db":{db},"@/db/schema":schema,"@/lib/auth":{getSessionUser:async()=>actor}};
   common["@/lib/api"]=moduleAt("../lib/api.ts",common);
   common["@/lib/activity"]=moduleAt("../lib/activity.ts",common);
   common["@/lib/notify"]=moduleAt("../lib/notify.ts",common);
   return {create:moduleAt("../app/api/tasks/route.ts",common).POST,
    ...moduleAt("../app/api/tasks/[id]/route.ts",common),
    comment:moduleAt("../app/api/tasks/[id]/comments/route.ts",common).POST};
  }
  const req=(method,body)=>new Request("http://localhost/api",{method,body:JSON.stringify(body)});
  const create=()=>req("POST",{projectId:project.id,title:"测试任务",assigneeId:recipient.id,labelIds:[label.id]});
  for(const failure of [activities,notifications]) {
   assert.equal((await routes(failure).create(create())).status,500);
   assert.equal((await outer.select().from(tasks).where(eq(tasks.projectId,project.id))).length,0);
  }
  const response=await routes().create(create());assert.equal(response.status,201);
  const task=(await response.json()).task;const ctx={params:Promise.resolve({id:String(task.id)})};
  for(const failure of [activities,notifications]) {
   assert.equal((await routes(failure).PUT(req("PUT",{title:"失败改名",status:"done",assigneeId:actor.id,labelIds:[]}),ctx)).status, failure===notifications?200:500);
  }
  // Force assignment to another user so notification insertion is exercised.
  assert.equal((await routes(notifications).PUT(req("PUT",{title:"通知失败",assigneeId:recipient.id}),ctx)).status,500);
  assert.notEqual((await outer.select().from(tasks).where(eq(tasks.id,task.id)))[0].title,"通知失败");
  assert.equal((await routes(notifications).comment(req("POST",{content:`@${recipient.name} 评论测试`}),ctx)).status,500);
  assert.equal((await outer.select().from(comments).where(eq(comments.taskId,task.id))).length,0);
  assert.equal((await routes(activities).DELETE(new Request("http://localhost/api",{method:"DELETE"}),ctx)).status,500);
  assert.equal((await outer.select().from(tasks).where(eq(tasks.id,task.id))).length,1);
  assert.equal((await routes().DELETE(new Request("http://localhost/api",{method:"DELETE"}),ctx)).status,200);
  throw rollback;
 }),error=>error===rollback);
 } finally {await client.end();}
});
