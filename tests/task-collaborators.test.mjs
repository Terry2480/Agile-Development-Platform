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

const {users,teams,teamMembers,projects,tasks,taskCollaborators,notifications}=schema;
test("collaborators receive unique assignment reminders and all see shared todos",async()=>{
 const client=postgres(process.env.DATABASE_URL,{max:1});const rollback=new Error("rollback collaborators");
 try{await assert.rejects(drizzle(client).transaction(async tx=>{
  const suffix=randomUUID();
  const [owner,helper,third,outsider]=await tx.insert(users).values(["owner","helper","third","outsider"].map(name=>({name,email:`${name}-${suffix}@example.test`,studentId:`${name}-${suffix}`,passwordHash:"test-only"}))).returning();
  const [team]=await tx.insert(teams).values({name:"协作测试",ownerId:owner.id}).returning();
  await tx.insert(teamMembers).values([owner,helper,third].map(u=>({teamId:team.id,userId:u.id,role:u.id===owner.id?"owner":"member"})));
  const [project]=await tx.insert(projects).values({teamId:team.id,name:"协作测试",key:"CO"}).returning();
  let actor=owner;let failNotify=false;
  const common={"@/db":{db:tx},"@/db/schema":schema,"@/lib/auth":{getSessionUser:async()=>actor}};
  common["@/lib/api"]=moduleAt("../lib/api.ts",common);
  common["@/lib/activity"]=moduleAt("../lib/activity.ts",common);
  const notify=moduleAt("../lib/notify.ts",common);
  common["@/lib/task-collaborators"]=moduleAt("../lib/task-collaborators.ts",{...common,"./api":common["@/lib/api"],"./notify":{notify:async(...args)=>{if(failNotify)throw new Error("notification failure");return notify.notify(...args);}}});
  const list=moduleAt("../app/api/tasks/route.ts",common);
  const detail=moduleAt("../app/api/tasks/[id]/route.ts",common);
  const overview=moduleAt("../app/api/overview/route.ts",common).GET;
  const req=(method,body)=>new Request("http://localhost/api",{method,body:JSON.stringify(body)});
  const create=ids=>list.POST(req("POST",{projectId:project.id,title:"多人汇报",assigneeId:owner.id,collaboratorIds:ids}));
  assert.equal((await create([outsider.id])).status,400);
  assert.equal((await tx.select().from(tasks).where(eq(tasks.projectId,project.id))).length,0);
  failNotify=true;assert.equal((await create([helper.id])).status,500);failNotify=false;
  assert.equal((await tx.select().from(tasks).where(eq(tasks.projectId,project.id))).length,0);
  const response=await create([helper.id,helper.id]);assert.equal(response.status,201);
  const task=(await response.json()).task;const ctx={params:Promise.resolve({id:String(task.id)})};
  const members=async()=>(await tx.select().from(taskCollaborators).where(eq(taskCollaborators.taskId,task.id))).map(c=>c.userId).sort((a,b)=>a-b);
  assert.deepEqual(await members(),[owner.id,helper.id].sort((a,b)=>a-b));
  const notices=async()=>tx.select().from(notifications).where(eq(notifications.entityId,task.id));
  assert.deepEqual((await notices()).map(n=>n.userId).sort((a,b)=>a-b),[owner.id,helper.id].sort((a,b)=>a-b));
  for(const participant of [owner,helper]){
   actor=participant;
   assert.equal((await (await list.GET(new Request(`http://localhost/api/tasks?projectId=${project.id}&mine=1`))).json()).tasks.length,1);
   assert.equal((await (await overview(new Request("http://localhost/api/overview"))).json()).overview.myTodo,1);
  }
  actor=owner;
  assert.equal((await detail.PUT(req("PUT",{collaboratorIds:[helper.id,third.id]}),ctx)).status,200);
  assert.equal((await notices()).length,3);
  assert.equal((await detail.PUT(req("PUT",{collaboratorIds:[helper.id,third.id]}),ctx)).status,200);
  assert.equal((await notices()).length,3);
  const data=await (await detail.GET(new Request("http://localhost/api"),ctx)).json();assert.equal(data.task.collaborators.length,3);
  assert.equal((await detail.PUT(req("PUT",{collaboratorIds:[]}),ctx)).status,200);
  assert.deepEqual(await members(),[owner.id]);
  actor=helper;assert.equal((await (await list.GET(new Request("http://localhost/api/tasks?mine=1"))).json()).tasks.some(t=>t.id===task.id),false);
  actor=outsider;assert.equal((await detail.GET(new Request("http://localhost/api"),ctx)).status,404);
  actor=owner;await detail.DELETE(new Request("http://localhost/api",{method:"DELETE"}),ctx);assert.deepEqual(await members(),[]);
  throw rollback;
 }),e=>e===rollback);}finally{await client.end();}
});
