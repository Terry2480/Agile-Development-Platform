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
  runInNewContext(source, { exports, process, Response, Request, File, Buffer, URL, console: { error() {} }, require: name => overrides[name] ?? require(name) });
  return exports;
}
const schema = moduleAt("../db/schema.ts");

const {users,teams,teamMembers,projects,milestones,milestoneResources,attachments,fileCleanup}=schema;
test("milestone files and links respect ownership, project boundaries, and atomic upload association",async()=>{
 const client=postgres(process.env.DATABASE_URL,{max:1});const rollback=new Error("rollback resources");
 try{await assert.rejects(drizzle(client).transaction(async tx=>{
  const suffix=randomUUID();
  const [owner,member,outsider]=await tx.insert(users).values(["owner","member","outsider"].map(name=>({name,email:`${name}-${suffix}@example.test`,studentId:`${name}-${suffix}`,passwordHash:"test-only"}))).returning();
  const [team]=await tx.insert(teams).values({name:"成果测试",ownerId:owner.id}).returning();
  await tx.insert(teamMembers).values([owner,member].map(u=>({teamId:team.id,userId:u.id,role:u.id===owner.id?"owner":"member"})));
  const [project,otherProject]=await tx.insert(projects).values(["MR","OT"].map(key=>({teamId:team.id,name:key,key}))).returning();
  const [milestone,second,foreign]=await tx.insert(milestones).values([{projectId:project.id,name:"中期"},{projectId:project.id,name:"最终"},{projectId:otherProject.id,name:"其他项目"}].map(m=>({...m,dueOn:"2026-10-20"}))).returning();
  const [file,otherFile]=await tx.insert(attachments).values([project,otherProject].map((p,i)=>({projectId:p.id,uploaderId:owner.id,originalName:"报告.pdf",storedName:`resource-${suffix}-${i}`,size:10}))).returning();
  let actor=owner;const memoryFiles=new Map();let rejectResource=false;
  const db=new Proxy(tx,{get(target,key){
   if(key==="transaction")return fn=>target.transaction(inner=>fn(new Proxy(inner,{get(innerTarget,prop){
    if(prop==="insert")return table=>{if(rejectResource&&table===milestoneResources)throw new Error("injected association failure");return innerTarget.insert(table);};
    const value=innerTarget[prop];return typeof value==="function"?value.bind(innerTarget):value;
   }})));
   const value=target[key];return typeof value==="function"?value.bind(target):value;
  }});
  const common={"@/db":{db},"@/db/schema":schema,"@/lib/auth":{getSessionUser:async()=>actor}};
  common["@/lib/api"]=moduleAt("../lib/api.ts",common);common["@/lib/activity"]=moduleAt("../lib/activity.ts",common);
  common["@/lib/file-cleanup"]={uploadPath:name=>`/virtual/${name}`,tryFileCleanup:async()=>{for(const key of memoryFiles.keys()){const name=key.split('/').at(-1);if(!(await tx.select().from(attachments).where(eq(attachments.storedName,name))).length){memoryFiles.delete(key);await tx.delete(fileCleanup).where(eq(fileCleanup.storedName,name));}}}};
  const route=moduleAt("../app/api/projects/[id]/milestones/[milestoneId]/resources/route.ts",common);
  const upload=moduleAt("../app/api/projects/[id]/files/route.ts",{...common,"node:fs/promises":{mkdir:async()=>{},writeFile:async(path,data)=>memoryFiles.set(path,data)},"@/lib/upload-limits":{MAX_UPLOAD_BYTES:100*1024*1024,UPLOAD_LIMIT_MESSAGE:"超限"}}).POST;
  const call=(method,body,m=milestone.id)=>route[method](new Request("http://localhost/api",{method,...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({id:String(project.id),milestoneId:String(m)})});
  const read=async()=>(await (await call("GET")).json()).resources;
  assert.equal((await call("POST",{attachmentId:otherFile.id})).status,400);
  assert.equal((await call("POST",{attachmentId:file.id},foreign.id)).status,404);
  assert.equal((await call("POST",{title:"危险链接",url:"javascript:alert(1)"})).status,400);
  assert.equal((await call("POST",{title:"无效链接",url:"invalid"})).status,400);
  assert.equal((await call("POST",{attachmentId:file.id})).status,201);
  assert.equal((await call("POST",{attachmentId:file.id})).status,409);
  assert.equal((await call("POST",{attachmentId:file.id},second.id)).status,201);
  const ownResource=(await read())[0];actor=member;
  assert.equal((await call("DELETE",{resourceId:ownResource.id})).status,403);
  assert.equal((await call("POST",{title:"原型",url:"https://example.test/prototype"})).status,201);
  const link=(await read()).find(r=>r.url);assert.equal((await call("DELETE",{resourceId:link.id})).status,200);
  actor=outsider;assert.equal((await call("GET")).status,404);actor=owner;
  const request=()=>{const form=new FormData();form.set("file",new File(["PPT"],"汇报.pptx"));form.set("milestoneId",String(milestone.id));return new Request("http://localhost/api",{method:"POST",body:form});};
  const context={params:Promise.resolve({id:String(project.id)})};
  rejectResource=true;assert.equal((await upload(request(),context)).status,500);rejectResource=false;
  assert.equal(memoryFiles.size,0,"failed association cleans staged file");
  assert.equal((await tx.select().from(attachments).where(eq(attachments.projectId,project.id))).length,1);
  assert.equal((await upload(request(),context)).status,201);
  assert.equal((await read()).length,2);
  assert.equal((await call("DELETE",{resourceId:ownResource.id})).status,200);
  assert.equal((await tx.select().from(attachments).where(eq(attachments.id,file.id))).length,1,"unlink preserves original file");
  await tx.delete(milestones).where(eq(milestones.id,milestone.id));
  assert.equal((await tx.select().from(milestoneResources).where(eq(milestoneResources.milestoneId,milestone.id))).length,0);
  assert.equal((await tx.select().from(attachments).where(eq(attachments.projectId,project.id))).length,2,"deleting milestone preserves library files");
  throw rollback;
 }),e=>e===rollback);}finally{await client.end();}
});
