import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
function moduleAt(path, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(source, { exports, process, Response, URL, console: { error() {} }, require: name => overrides[name] ?? require(name) });
  return exports;
}
const schema = moduleAt("../db/schema.ts");

const { users, teams, teamMembers, projects, tasks, taskChecklistItems: items } = schema;
test("checklist CRUD respects project access, item scope and task deletion without changing task status", async () => {
 const client = postgres(process.env.DATABASE_URL, { max: 1 });
 const rollback = new Error("rollback checklist fixtures");
 try {
  await assert.rejects(drizzle(client).transaction(async tx => {
   const suffix = randomUUID();
   const [owner, member, outsider] = await tx.insert(users).values(["owner", "member", "outsider"].map(name => ({name, email:`${name}-${suffix}@example.test`, studentId:`${name}-${suffix}`, passwordHash:"test-only"}))).returning();
   const [team] = await tx.insert(teams).values({name:"清单测试",ownerId:owner.id}).returning();
   await tx.insert(teamMembers).values([owner,member].map(user=>({teamId:team.id,userId:user.id,role:user.id===owner.id?"owner":"member"})));
   const [project] = await tx.insert(projects).values({teamId:team.id,name:"清单测试",key:"CL"}).returning();
   const [task, otherTask] = await tx.insert(tasks).values([1,2].map(number=>({projectId:project.id,number,title:`任务${number}`,status:"doing",createdById:owner.id}))).returning();
   let actor = owner;
   const common = {"@/db":{db:tx},"@/db/schema":schema,"@/lib/auth":{getSessionUser:async()=>actor}};
   common["@/lib/api"] = moduleAt("../lib/api.ts",common);
   const route = moduleAt("../app/api/tasks/[id]/checklist/route.ts", common);
   const call = (method,body,id=task.id)=>route[method](new Request("http://localhost/api",{method,...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({id:String(id)})});
   assert.deepEqual((await (await call("GET")).json()).items, []);
   assert.equal((await call("POST",{title:" "})).status,400);
   const response = await call("POST",{title:"  制作 PPT  "});
   assert.equal(response.status,201);
   const item = (await response.json()).item;
   assert.equal(item.title,"制作 PPT");
   assert.equal(item.completed,false);
   actor = member;
   assert.equal((await call("PUT",{itemId:item.id,completed:true})).status,200);
   assert.equal((await call("PUT",{itemId:item.id,title:"制作汇报 PPT"})).status,200);
   const persisted = (await (await call("GET")).json()).items;
   assert.equal(persisted[0].completed,true);
   assert.equal(persisted[0].title,"制作汇报 PPT");
   assert.equal((await tx.select().from(tasks).where(eq(tasks.id,task.id)))[0].status,"doing");
   assert.equal((await call("PUT",{itemId:item.id,completed:false},otherTask.id)).status,404);
   assert.equal((await call("DELETE",{itemId:item.id},otherTask.id)).status,404);
   actor = outsider;
   for(const method of ["GET","POST","PUT","DELETE"]) assert.equal((await call(method,method==="GET"?undefined:{title:"攻击",itemId:item.id,completed:false})).status,404);
   actor = member;
   assert.equal((await call("DELETE",{itemId:item.id})).status,200);
   assert.equal((await call("DELETE",{itemId:item.id})).status,404);
   assert.deepEqual((await (await call("GET")).json()).items,[]);
   await tx.insert(items).values(Array.from({length:50},(_,i)=>({taskId:task.id,title:`步骤${i}`})));
   assert.equal((await call("POST",{title:"超出上限"})).status,400);
   await tx.delete(tasks).where(eq(tasks.id,task.id));
   assert.equal((await tx.select().from(items).where(eq(items.taskId,task.id))).length,0);
   assert.equal((await call("GET")).status,404);
   throw rollback;
  }),error=>error===rollback);
 } finally {await client.end();}
});
