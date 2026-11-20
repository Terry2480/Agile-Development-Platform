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

const {users,teams,teamMembers,projects,tasks,taskCollaborators,notifications,taskDeadlineReminders}=schema;
test("deadline reminders deduplicate even after read deletion and cleanup preserves unread and other users",async()=>{
 const client=postgres(process.env.DATABASE_URL,{max:1});const rollback=new Error("rollback reminder fixtures");
 try{await assert.rejects(drizzle(client).transaction(async tx=>{
  const suffix=randomUUID();
  const [owner,helper,outsider]=await tx.insert(users).values(["owner","helper","outsider"].map(name=>({name,email:`${name}-${suffix}@example.test`,studentId:`${name}-${suffix}`,passwordHash:"test-only"}))).returning();
  const [team]=await tx.insert(teams).values({name:"截止测试",ownerId:owner.id}).returning();
  await tx.insert(teamMembers).values([owner,helper].map(u=>({teamId:team.id,userId:u.id,role:u.id===owner.id?"owner":"member"})));
  const [project]=await tx.insert(projects).values({teamId:team.id,name:"提醒测试",key:"RE"}).returning();
  const [{today,tomorrow,later}]=await tx.execute(require("drizzle-orm").sql`select (now() at time zone 'Asia/Hong_Kong')::date::text as today, ((now() at time zone 'Asia/Hong_Kong')::date+1)::text as tomorrow, ((now() at time zone 'Asia/Hong_Kong')::date+2)::text as later`);
  const made=await tx.insert(tasks).values([
   {number:1,dueOn:tomorrow,status:"todo"},{number:2,dueOn:today,status:"doing"},{number:3,dueOn:tomorrow,status:"done"},{number:4,dueOn:later,status:"todo"}
  ].map(t=>({...t,projectId:project.id,title:"截止测试",assigneeId:owner.id}))).returning();
  await tx.insert(taskCollaborators).values([owner,helper,outsider].map(u=>({taskId:made[0].id,userId:u.id})));
  let actor=owner;
  const common={"@/db":{db:tx},"@/db/schema":schema,"@/lib/auth":{getSessionUser:async()=>actor}};
  common["@/lib/api"]=moduleAt("../lib/api.ts",common);
  const reminders=moduleAt("../lib/deadline-reminders.ts",common);
  common["@/lib/deadline-reminders"]={tryDeadlineReminders:async()=>{}};
  const route=moduleAt("../app/api/notifications/route.ts",common);
  const run=()=>reminders.generateDeadlineReminders(tx);
  const read=()=>tx.select().from(notifications).where(require("drizzle-orm").and(eq(notifications.entityId,made[0].id),eq(notifications.type,"deadline")));
  await run();assert.equal((await read()).length,2);
  await run();assert.equal((await read()).length,2);
  const dueToday=await tx.select().from(notifications).where(eq(notifications.entityId,made[1].id));assert.equal(dueToday.length,1);assert.match(dueToday[0].title,/今天截止/);
  for(const t of made.slice(2))assert.equal((await tx.select().from(taskDeadlineReminders).where(eq(taskDeadlineReminders.taskId,t.id))).length,0);
  const notices=await read();const own=notices.find(n=>n.userId===owner.id);const other=notices.find(n=>n.userId===helper.id);
  await tx.update(notifications).set({read:true}).where(eq(notifications.id,other.id));
  const del=body=>route.DELETE(new Request("http://localhost/api",{method:"DELETE",body:JSON.stringify(body)}));
  assert.equal((await del({ids:[]})).status,400);
  assert.equal((await (await del({ids:[own.id,other.id]})).json()).deletedCount,0,"unread and another user's notifications are protected");
  await tx.update(notifications).set({read:true}).where(eq(notifications.id,own.id));
  assert.equal((await (await del({allRead:true})).json()).deletedCount,1);
  await run();assert.equal((await read()).length,1,"deleting notification must not send it again");
  actor=helper;assert.equal((await (await del({allRead:true})).json()).deletedCount,1);
  await run();assert.equal((await read()).length,0);
  await tx.update(tasks).set({dueOn:today}).where(eq(tasks.id,made[0].id));
  await run();assert.equal((await read()).length,2,"new deadline gets one reminder");
  await run();assert.equal((await read()).length,2);
  throw rollback;
 }),e=>e===rollback);}finally{await client.end();}
});
