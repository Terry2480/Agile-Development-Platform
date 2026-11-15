// Optional Windows browser rehearsal. Uses a separate cloned local database only.
import { config } from "dotenv";
import postgres from "postgres";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
config({ path: ".env.local", quiet: true });
const artifacts = process.env.DOCUMENT_UI_ARTIFACT_DIR;
if (!artifacts || !path.isAbsolute(artifacts)) throw Error("DOCUMENT_UI_ARTIFACT_DIR_REQUIRED");
mkdirSync(artifacts, { recursive: true });
const url = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
url.pathname = "/postgres";
const admin = postgres(url.toString(), { max: 1 });
const databaseName = "agilecampus_test_documents_api_20261112";
try {
  if (!(await admin`SELECT 1 FROM pg_database WHERE datname=${databaseName}`).length)
    await admin.unsafe(`CREATE DATABASE ${databaseName} TEMPLATE agilecampus_test_documents_20261112_v3`);
} finally { await admin.end(); }
url.pathname = `/${databaseName}`;
const db = postgres(url.toString(), { max: 1 });
const suffix = randomUUID(); const token = randomBytes(32).toString("hex");
const salt = randomBytes(16).toString("hex");
const passwordHash = salt + ":" + scryptSync(randomBytes(24).toString("hex"), salt, 64).toString("hex");
let project, team, actor, task, milestone;
try {
  [actor] = await db`INSERT INTO users(email,student_id,password_hash,name) VALUES(${suffix+'@example.test'},${suffix},${passwordHash},'目录演练成员') RETURNING id`;
  [team] = await db`INSERT INTO teams(name,owner_id) VALUES('文档系统验收团队',${actor.id}) RETURNING id`;
  await db`INSERT INTO team_members(team_id,user_id,role) VALUES(${team.id},${actor.id},'owner')`;
  [project] = await db`INSERT INTO projects(team_id,name,key) VALUES(${team.id},'文档系统 · 接口与页面验收','DOCUI') RETURNING id`;
  [task] = await db`INSERT INTO tasks(project_id,number,title) VALUES(${project.id},1,'关联验收任务') RETURNING id`;
  [milestone] = await db`INSERT INTO milestones(project_id,name,due_on) VALUES(${project.id},'关联验收里程碑','2026-11-25') RETURNING id`;
  await db`INSERT INTO sessions(token,user_id,expires_at,last_active_at) VALUES(${token},${actor.id},now()+interval '1 hour',now())`;
} finally { await db.end(); }

const port = 3114; const origin = `http://localhost:${port}`;
const log = openSync(path.join(artifacts, "document-next-rehearsal.log"), "w");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
  windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env, DATABASE_URL: url.toString(), DOCUMENT_UI_REHEARSAL: "check", UPLOAD_DIR:path.join(process.cwd(),"uploads-document-review"), AUTH_ALLOWED_ORIGINS: origin },
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws; let seq = 0; const pending = new Map(); const checks = [];
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function request(route, method = "GET", body, authenticated = true, expected = 200, requestOrigin = origin) {
  const response = await fetch(origin + route, { method, headers: { ...(authenticated ? { Cookie: `agile_session=${token}` } : {}), Origin: requestOrigin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + "/login")).ok) { ready = true; break; } } catch {} await pause(300); }
  assert.ok(ready, "isolated Next server starts");
  const opened = await request(`/api/projects/${project.id}/document-space`); const space = opened.space;
  const root = (await request(`/api/document-spaces/${space.id}/nodes`)).nodes[0];
  await request(`/api/document-spaces/${space.id}/nodes`, "GET", null, false, 401);
  await request(`/api/document-spaces/${space.id}/nodes`, "POST", { kind: "folder", name: "CSRF", parentId: root.id, requestId: randomUUID() }, true, 403, "https://untrusted.example");
  await request(`/api/document-spaces/${space.id}/nodes`, "POST", { kind: "document", name: "非法根文档", parentId: null, requestId: randomUUID() }, true, 400);
  await request(`/api/document-spaces/${space.id}/nodes`, "POST", { kind: "link", name: "无效链接", url: "invalid", parentId: root.id, requestId: randomUUID() }, true, 400);
  await request(`/api/document-spaces/${space.id}/nodes?limit=invalid`, "GET", null, true, 400);
  await request(`/api/document-nodes/invalid`, "GET", null, true, 400);
  const body = { kind: "folder", name: "接口验收目录", parentId: root.id, requestId: randomUUID() };
  const created = await request(`/api/document-spaces/${space.id}/nodes`, "POST", body, true, 201);
  assert.equal((await request(`/api/document-spaces/${space.id}/nodes`, "POST", body, true, 201)).node.id, created.node.id);
  const renamed = await request(`/api/document-nodes/${created.node.id}`, "PATCH", { name: "接口验收目录（已改名）", expectedVersion: created.node.version });
  await request(`/api/document-nodes/${created.node.id}`, "PATCH", { name: "过期覆盖", expectedVersion: created.node.version }, true, 409);
  await request(`/api/document-nodes/${created.node.id}/move`, "POST", { targetSpaceId: space.id, targetParentId: null, expectedVersion: renamed.node.version, requestId: randomUUID() });
  checks.push("real HTTP authentication, CSRF, validation, persisted create/rename/move and retry");

  browser = spawn(process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9342", "--user-data-dir=" + path.join(artifacts, "edge-document-live"), "about:blank"], { windowsHide: true, stdio: "ignore" });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch("http://127.0.0.1:9342/json")).json(); break; } catch {} await pause(200); }
  assert.ok(targets, "headless browser starts");
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if(m.method === "Page.javascriptDialogOpening") { void call("Page.handleJavaScriptDialog", {accept:true}); } if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
  await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Network.setCookie", { name: "agile_session", value: token, url: origin, httpOnly: true, sameSite: "Lax" });
  await call("Page.navigate", { url: origin });
  async function run(expression) { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async function until(label, expression) { for (let i = 0; i < 100; i++) { if (await run(expression)) { checks.push(label); return; } await pause(200); } const state=await run(`({dialogs:[...document.querySelectorAll('dialog')].map(d=>({open:d.open,text:d.textContent.slice(0,2500)})),errors:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)})`);writeFileSync(path.join(artifacts,"document-ui-failure.json"),JSON.stringify({label,state},null,2));const shot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(path.join(artifacts,"document-ui-failure.png"),Buffer.from(shot.data,"base64"));throw Error(label); }
  const click = async text => {for(let i=0;i<100;i++){if(await run(`(()=>{const dialogs=[...document.querySelectorAll('dialog[open]')];const root=dialogs.at(-1)??document;const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true})()`))return;await pause(100);}throw Error('missing enabled button: '+text);};
  const input = text => run(`(()=>{const i=document.querySelector('dialog[open] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(text)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await until("workspace authenticated", `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='项目文档')`);
  await click("项目文档");
  await until("real directory list loads", `!!document.querySelector('.ws-doc-table')&&document.querySelector('.ws-doc-main').textContent.includes('接口验收目录（已改名）')`);
  await click("＋ 新建分区"); await until("partition dialog opens", `!!document.querySelector('dialog[open] input')`);
  await input("页面验收分区"); await click("创建");
  await until("UI create updates list", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('页面验收分区')`);
  await run(`document.querySelector('button[aria-label="页面验收分区的更多操作"]').click()`);
  await click("重命名"); await until("rename dialog opens", `!!document.querySelector('dialog[open] input')`);
  await input("页面验收分区（已保存）"); await click("保存名称");
  await until("UI rename updates list", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('页面验收分区（已保存）')`);
  await click("页面验收分区（已保存）");
  await until("folder navigation updates breadcrumb", `document.querySelector('.ws-doc-breadcrumb')?.textContent.includes('页面验收分区（已保存）')`);
  await run(`(()=>{[...document.querySelectorAll('.ws-doc-titleline button')].find(b=>b.textContent.includes('新建')).click();return true})()`);
  await click("在线文档"); await until("document dialog opens", `!!document.querySelector('dialog[open] input')`);
  await input("第二阶段实施笔记"); await click("创建");
  await until("document creation persists", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记')`);
  await click("第二阶段实施笔记");
  await until("detail loads body and associations", `!!document.querySelector('dialog[open] .ws-doc-readbody')&&document.querySelector('dialog[open]').textContent.includes('暂无关联')`);
  await click("编辑正文");
  await until("editor acquires lock and exposes writing", `!!document.querySelector('dialog[open] [contenteditable="true"]')`);
  await run(`(()=>{const e=document.querySelector('dialog[open] [contenteditable="true"]');e.focus();e.textContent='正文编辑浏览器验收：自动保存后刷新仍保留。';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return true})()`);
  await until("editor autosave succeeds", `document.querySelector('.ws-body-editor [role="status"]')?.textContent==='已保存'`);
  await run(`(()=>{const e=document.querySelector('dialog[open] [contenteditable="true"]');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return true})()`);
  await call("Input.insertText",{text:"A"}); await pause(80); await call("Input.insertText",{text:"B"});
  await until("typing preserves caret order", `document.querySelector('dialog[open] [contenteditable="true"]')?.textContent.endsWith('AB')`);
  await until("typed text autosaves", `document.querySelector('.ws-body-editor [role="status"]')?.textContent==='已保存'`);
  await call("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await run(`(()=>{const e=document.querySelector('dialog[open] [contenteditable="true"]');e.textContent+=' 离线草稿';e.dispatchEvent(new InputEvent('input',{bubbles:true}));return true})()`);
  await until("offline save preserves draft", `document.querySelector('.ws-body-editor [role="status"]')?.textContent.includes('保存失败')&&Object.keys(localStorage).some(k=>k.startsWith('agile-doc-draft:')&&localStorage.getItem(k).includes('离线草稿'))`);
  await call("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await click("立即保存");
  await until("reconnection retries same save successfully", `document.querySelector('.ws-body-editor [role="status"]')?.textContent==='已保存'`);
  const editorShot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(path.join(artifacts,"document-body-editor.png"),Buffer.from(editorShot.data,"base64"));
  await click("保存当前版本");
  await until("manual history checkpoint saved", `document.querySelector('.ws-body-editor [role="status"]')?.textContent.includes('版本已保存')`);
  await click("历史版本");
  await until("version history lists snapshots", `document.querySelectorAll('.ws-version-list button').length>=2`);
  await run(`document.querySelector('.ws-version-list button').click()`);
  await until("historical body preview loads", `document.querySelector('.ws-version-preview')?.textContent.includes('正文编辑浏览器验收')`);
  await run(`(()=>{const e=document.querySelector('dialog[open] [contenteditable="true"]');e.textContent='临时正文：待恢复旧版本';e.dispatchEvent(new InputEvent('input',{bubbles:true}));return true})()`);
  await until("changed body saved before restore", `document.querySelector('.ws-body-editor [role="status"]')?.textContent==='已保存'`);
  await click("恢复此版本");
  await until("confirmed restore writes selected historical body", `document.querySelector('.ws-body-editor [role="status"]')?.textContent.includes('历史正文已恢复')&&document.querySelector('dialog[open] [contenteditable="true"]')?.textContent.includes('正文编辑浏览器验收')`);
  await until("restore creates protection snapshot", `document.querySelector('.ws-version-list')?.textContent.includes('恢复前保护')`);
  const historyShot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  writeFileSync(path.join(artifacts,"document-history-live.png"),Buffer.from(historyShot.data,"base64"));
  await click("历史版本");
  await click("保存并结束编辑");
  await until("finish editing releases lock and preserves reading content", `!![...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='编辑正文')&&document.querySelector('dialog[open]')?.textContent.includes('正文编辑浏览器验收')`);
  await click("编辑正文");
  await until("reopening editor reads saved server body", `document.querySelector('dialog[open] [contenteditable="true"]')?.textContent.includes('正文编辑浏览器验收')`);
  await click("保存并结束编辑");
  await until("second editor finishes", `!![...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='编辑正文')`);
  await run(`document.querySelector('dialog[open] header button').click()`);
  await until("list refreshes document revision after editing", `!!document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]')`);
  await click("上传文件");
  await until("upload dialog opens", `!!document.querySelector('dialog[open] input[type="file"]')`);
  const png=await run(`(()=>{const c=document.createElement('canvas');c.width=480;c.height=180;const x=c.getContext('2d');x.fillStyle='#eef3ff';x.fillRect(0,0,480,180);x.fillStyle='#315cc9';x.fillRect(20,25,90,130);x.fillStyle='#24364e';x.font='24px sans-serif';x.fillText('文档系统验收图片',135,80);x.font='16px sans-serif';x.fillText('PNG / internal resource / export',135,120);return c.toDataURL('image/png').split(',')[1]})()`);
  await run(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));const f=new File([bytes],'验收图片.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(f);const i=document.querySelector('dialog[open] input[type="file"]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await click("上传");
  await until("uploaded file appears in directory", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('验收图片.png')`);
  await click("验收图片.png");
  await until("authenticated image preview decodes", `!!document.querySelector('.ws-document-file-preview img')?.naturalWidth`);
  const fileShot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(path.join(artifacts,"document-file-preview.png"),Buffer.from(fileShot.data,"base64"));
  const downloadUrl=await run(`document.querySelector('.ws-document-file-preview a').getAttribute('href')`);
  const bytes=Buffer.from(png,"base64");
  const downloaded=await fetch(origin+downloadUrl,{headers:{Cookie:`agile_session=${token}`}});
  assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
  const ranged=await fetch(origin+downloadUrl,{headers:{Cookie:`agile_session=${token}`,Range:"bytes=0-7"}});
  assert.equal(ranged.status,206);assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),bytes.subarray(0,8));
  const head=await fetch(origin+downloadUrl,{method:"HEAD",headers:{Cookie:`agile_session=${token}`}});assert.equal(head.status,200);assert.equal(head.headers.get("content-length"),String(bytes.length));
  const invalidRange=await fetch(origin+downloadUrl,{headers:{Cookie:`agile_session=${token}`,Range:"bytes=999999-"}});assert.equal(invalidRange.status,416);
  assert.equal((await fetch(origin+downloadUrl)).status,401);
  checks.push("file bytes, authenticated download, HEAD and video-style byte ranges");
  const uploadExtra=async(name,bytes,type)=>{
    const form=new FormData();form.set("file",new File([bytes],name,{type}));form.set("parentId",String((await request(`/api/document-nodes/${downloadUrl.split('/')[3]}`)).node.parentId));form.set("requestId",randomUUID());
    const r=await fetch(origin+`/api/document-spaces/${space.id}/uploads`,{method:"POST",headers:{Cookie:`agile_session=${token}`,Origin:origin},body:form});const data=await r.json();assert.equal(r.status,201,JSON.stringify(data));return data.node;
  };
  const pdfObjects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>","<< /Length 0 >>\nstream\n\nendstream"];
  let pdf="%PDF-1.4\n";const offsets=[0];for(let i=0;i<pdfObjects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${pdfObjects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdfNode=await uploadExtra("验收.pdf",Buffer.from(pdf),"application/pdf");
  const pdfResponse=await fetch(origin+`/api/document-nodes/${pdfNode.id}/file?preview=1`,{headers:{Cookie:`agile_session=${token}`}});assert.equal(pdfResponse.headers.get("content-type"),"application/pdf");assert.ok(pdfResponse.headers.get("content-disposition").startsWith("inline"));
  const unsafe=await uploadExtra("伪装图片.html",Buffer.from("<script>alert(1)</script>"),"image/png");
  const unsafeResponse=await fetch(origin+`/api/document-nodes/${unsafe.id}/file?preview=1`,{headers:{Cookie:`agile_session=${token}`}});assert.equal(unsafeResponse.headers.get("content-type"),"application/octet-stream");assert.ok(unsafeResponse.headers.get("content-disposition").startsWith("attachment"));
  checks.push("PDF inline delivery and spoofed active HTML forced to safe download");

  await run(`document.querySelector('dialog[open] header button').click()`);
  await until("list refreshes after file preview", `!!document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]')`);
  await run(`document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]').click()`);
  await click("移动到…");
  await until("move destination folders load", `!!document.querySelector('dialog[open] .ws-doc-destination')?.textContent.includes('项目文档')`);
  await click("▸ 项目文档");
  await until("move target breadcrumb updates", `document.querySelector('dialog[open] nav')?.textContent.includes('项目文档')&&!document.querySelector('dialog[open] button.primary').disabled`);
  await click("移动到此处");
  await until("UI move removes document from source", `!document.querySelector('dialog[open]')&&!!document.querySelector('.ws-doc-table')&&!document.querySelector('.ws-doc-table').textContent.includes('第二阶段实施笔记')`);
  await run(`(()=>{const i=document.querySelector('.ws-doc-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'第二阶段实施笔记');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await until("space search finds moved document", `!!document.querySelector('.ws-doc-location')&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记')`);
  await click("所在目录");
  await until("search result locates destination folder", `document.querySelector('.ws-doc-breadcrumb')?.textContent.includes('项目文档')&&document.querySelector('.ws-doc-search input').value===''&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记')`);
  await click("团队公共资料 ↗");
  await until("team public space opens independently", `!!document.querySelector('.ws-doc-context')?.textContent.includes('团队公共资料')&&!!document.querySelector('.ws-doc-table')`);
  assert.ok(await run(`["团队规范","共享参考","公共素材"].every(name=>document.querySelector('.ws-doc-table')?.textContent.includes(name))`));
  assert.ok(await run(`["项目工作台","通知中心","我的待办"].every(name=>[...document.querySelectorAll('.ws-rail small')].some(n=>n.textContent===name))`));
  checks.push("team public categories differ from project defaults and rail labels stay visible");
  const publicShot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(path.join(artifacts, "team-public-layout.png"), Buffer.from(publicShot.data, "base64"));
  await click("项目文档");
  await until("switching back restores project directory", `document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记')`);
  await call("Page.reload");
  await until("workspace reloads", `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='项目文档')`);
  await click("项目文档");
  await until("directory selection and saved data survive reload", `!!document.querySelector('.ws-doc-table')&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记')`);
  const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(path.join(artifacts, "document-directory-live.png"), Buffer.from(shot.data, "base64"));
  assert.ok(await run(`document.documentElement.scrollWidth<=window.innerWidth+1`));
  checks.push("desktop 1440px fits without page overflow");
  await call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(200);
  assert.ok(await run(`document.documentElement.scrollWidth<=window.innerWidth+1`));
  checks.push("desktop 1024px fits without page overflow");
  await run(`document.querySelector('button[aria-label="切换日间模式"]')?.click()`);
  await until("day theme preserves directory", `!!document.querySelector('button[aria-label="切换夜间模式"]')&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记')`);
  const day = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(path.join(artifacts, "document-directory-live-day.png"), Buffer.from(day.data, "base64"));
  for (const [kind, target] of [["milestone", milestone], ["task", task]]) {
    await click(kind === "task" ? "项目任务" : "项目概览");
    if (kind === "task") {
      await until("task list loads for association", `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='看板')`);
      await click("看板");
      await until("task card loads", `!!document.querySelector('button[aria-label="查看任务 关联验收任务"]')`);
      await run(`document.querySelector('button[aria-label="查看任务 关联验收任务"]').click()`);
    }
    await until(kind + " association panel loads", `!!document.querySelector('.ws-document-associations button')&&!document.querySelector('.ws-document-associations button').disabled`);
    await click("关联已有资料");
    await until(kind + " picker opens", `!!document.querySelector('dialog[open] .ws-doc-destination')?.textContent.includes('项目文档')`);
    await click("▸ 项目文档");
    await until(kind + " picker lists document", `!!document.querySelector('dialog[open] .ws-doc-pick-row input')`);
    await run(`document.querySelector('dialog[open] .ws-doc-pick-row input').click()`);
    await click("关联所选资料（1）");
    await until(kind + " association persists in panel", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-document-associations')?.textContent.includes('第二阶段实施笔记')`);
    const saved = await request(`/api/${kind === "task" ? "tasks" : "milestones"}/${target.id}/document-associations`);
    assert.equal(saved.nodes.length, 1);
    const docId = saved.nodes[0].id;
    assert.ok((await request(`/api/document-nodes/${docId}`)).associations.some(a => a.type === kind && a.id === target.id));
    await click("第二阶段实施笔记");
    await until(kind + " details show reverse association", `!!document.querySelector('dialog[open]')?.textContent.includes(${JSON.stringify(kind === "task" ? "关联验收任务" : "关联验收里程碑")})`);
    await run(`document.querySelector('dialog[open] header button').click()`);
    const associationShot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(path.join(artifacts, "document-association-" + kind + ".png"), Buffer.from(associationShot.data, "base64"));
    await until(kind + " association list refreshes after details", `!![...document.querySelectorAll('.ws-document-associations button')].find(b=>b.textContent==='解除关联')`);
    await click("解除关联");
    await until(kind + " unlink keeps original document", `document.querySelector('.ws-document-associations')?.textContent.includes('暂无关联资料')`);
    assert.equal((await request(`/api/document-nodes/${docId}`)).node.id, docId);
  }
  await run(`document.querySelector('button[aria-label="关闭任务详情"]').click()`);
  await click("项目文档");
  await until("directory loads for lifecycle review", `!!document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]')`);
  await run(`document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]').click()`);await click("复制到…");
  await until("copy destination loads", `document.querySelector('dialog[open] .ws-doc-destination')?.textContent.includes('项目文档')`);
  await click("▸ 项目文档");await until("copy folder selected", `document.querySelector('dialog[open] nav')?.textContent.includes('项目文档')`);
  await click("复制到此处");await until("copy appears with independent identity", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记（副本）')`);
  await run(`document.querySelector('button[aria-label="第二阶段实施笔记（副本）的更多操作"]').click()`);await click("移入回收站");
  await until("trash impact confirmation loads", `!![...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='确认移入回收站'&&!b.disabled)`);
  await click("确认移入回收站");await until("trashed copy disappears from active directory", `!document.querySelector('dialog[open]')&&!!document.querySelector('.ws-doc-table')&&!document.querySelector('.ws-doc-table').textContent.includes('第二阶段实施笔记（副本）')`);
  await click("回收站");await until("trash list shows expiry", `document.querySelector('dialog[open]')?.textContent.includes('第二阶段实施笔记（副本）')&&document.querySelector('dialog[open]').textContent.includes('到期：')`);
  await click("第二阶段实施笔记（副本）");await until("trash body is readable but not editable", `document.querySelectorAll('dialog[open]').length===2&&document.querySelector('dialog[open]:last-of-type')?.textContent.includes('正文编辑浏览器验收')`);
  await run(`document.querySelectorAll('dialog[open] header button')[1].click()`);
  await click("恢复");await until("restore returns original position", `document.querySelector('dialog[open]')?.textContent.includes('已恢复')`);
  const trashShot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(path.join(artifacts,"document-trash-live.png"),Buffer.from(trashShot.data,"base64"));
  await click("关闭");await until("restored copy appears in directory", `!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('第二阶段实施笔记（副本）')`);
  await click("第二阶段实施笔记");await until("rich editor reopens",`!![...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='编辑正文')`);await click("编辑正文");await until("rich tools available",`!![...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='插入表格')`);
  await click("插入表格");await until("table has editable cells",`document.querySelectorAll('.ws-body-editable td').length===9`);
  await run(`document.querySelector('.ws-body-editable td [contenteditable]').focus()`);await click("表格加行");await click("表格加列");await until("table dimensions extend",`document.querySelectorAll('.ws-body-editable td').length===16`);
  await click("代码块");await click("插入链接");await until("link dialog opens",`document.querySelectorAll('dialog[open]').length===2`);
  await run(`(()=>{const inputs=[...document.querySelectorAll('dialog[open]')].at(-1).querySelectorAll('input');for(const [i,v] of [[0,'验收链接'],[1,'https://example.test/acceptance']]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[i],v);inputs[i].dispatchEvent(new Event('input',{bubbles:true}));}return true})()`);await click("插入");
  await run(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'正文粘贴图片.png',{type:'image/png'}));document.querySelector('.ws-body-editable').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));return true})()`);
  await until("pasted internal image decodes",`!!document.querySelector('.ws-body-editable img')?.naturalWidth`);
  await until("rich content autosaves",`document.querySelector('.ws-body-editor [role="status"]')?.textContent==='已保存'`);
  const richShot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(path.join(artifacts,"document-rich-editor.png"),Buffer.from(richShot.data,"base64"));
  await click("保存并结束编辑");await until("rich reading preserves table link and image",`!!document.querySelector('.ws-doc-readbody img')?.naturalWidth&&document.querySelectorAll('.ws-doc-readbody td').length===16&&!!document.querySelector('.ws-doc-readbody a[href="https://example.test/acceptance"]')`);
  const imageUrl=await run(`document.querySelector('.ws-doc-readbody img').getAttribute('src')`);assert.equal((await fetch(origin+imageUrl)).status,401);
  await run(`document.querySelector('dialog[open] header button').click()`);await until("rich document closes",`!document.querySelector('dialog[open]')`);
  await until("directory reloads before export",`!!document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]')`);
  await run(`document.querySelector('button[aria-label="第二阶段实施笔记的更多操作"]').click()`);await click("导出此项");await until("export range and limits visible",`document.querySelector('dialog[open]')?.textContent.includes('500MB')`);await click("创建导出任务");
  await until("Markdown export finishes through background worker",`document.querySelector('dialog[open]')?.textContent.includes('完整成功')&&!!document.querySelector('dialog[open] a[href*="/api/document-exports/"]')`);
  const exportUrl=await run(`document.querySelector('dialog[open] a[href*="/api/document-exports/"]').getAttribute('href')`);const exported=await fetch(origin+exportUrl,{headers:{Cookie:`agile_session=${token}`}});assert.equal(exported.status,200);assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,2).toString(),"PK");assert.equal((await fetch(origin+exportUrl)).status,401);
  const exportShot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(path.join(artifacts,"document-export-jobs.png"),Buffer.from(exportShot.data,"base64"));await click("关闭");
  // The old URL resolves through the canonical node rather than a second binary.
  const fileDetail=await request(downloadUrl.replace('/file',''));assert.ok(fileDetail.legacyDownloadUrl);const oldDownload=await fetch(origin+fileDetail.legacyDownloadUrl,{headers:{Cookie:`agile_session=${token}`}});assert.equal(oldDownload.status,200);assert.deepEqual(Buffer.from(await oldDownload.arrayBuffer()),bytes);checks.push("legacy URL streams exactly the same uploaded binary");
  await run(`(()=>{[...document.querySelectorAll('.ws-doc-titleline button')].find(b=>b.textContent.includes('新建')).click();return true})()`);await click("在线文档");await until("template selector exposes both groups",`document.querySelector('dialog[open] select')?.options.length===10`);await input("模板验收会议记录");await run(`(()=>{const s=document.querySelector('dialog[open] select');s.value='meeting';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await click("创建");await until("template document created",`!document.querySelector('dialog[open]')&&document.querySelector('.ws-doc-table')?.textContent.includes('模板验收会议记录')`);await click("模板验收会议记录");await until("template supplies editable structure",`document.querySelector('.ws-doc-readbody')?.textContent.includes('会议')`);await run(`document.querySelector('dialog[open] header button').click()`);
  await until("directory ready for content updates",`!!document.querySelector('.ws-doc-table')&&!document.querySelector('dialog[open]')`);
  const richListing=await request(`/api/document-spaces/${space.id}/nodes?q=${encodeURIComponent('第二阶段实施笔记')}`);const richNode=richListing.nodes.find(n=>n.name==='第二阶段实施笔记');
  const form=new FormData();form.set("file",new File(["before replacement"],"UI替换验收.txt",{type:"text/plain"}));form.set("parentId",String(richNode.parentId));form.set("requestId",randomUUID());const uploadedUI=await fetch(origin+`/api/projects/${project.id}/files`,{method:"POST",headers:{Cookie:`agile_session=${token}`,Origin:origin},body:form});assert.equal(uploadedUI.status,201);const uiFile=await uploadedUI.json();
  await request(`/api/document-spaces/${space.id}/nodes`,"POST",{kind:"link",name:"UI链接验收",url:"https://example.test/before",parentId:richNode.parentId,requestId:randomUUID()},true,201);
  await click("刷新");await until("update samples load",`document.querySelector('.ws-doc-table')?.textContent.includes('UI替换验收.txt')&&document.querySelector('.ws-doc-table')?.textContent.includes('UI链接验收')`);await click("UI替换验收.txt");await until("file uploader attribution loads",`document.querySelector('dialog[open]')?.textContent.includes('原条目上传者')`);await click("替换文件");await until("replacement confirmation shows scope",`[...document.querySelectorAll('dialog[open]')].at(-1)?.textContent.includes('此前复制')`);
  await run(`(()=>{const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);const dt=new DataTransfer();dt.items.add(new File(['after replacement'],'新实体.txt',{type:'text/plain'}));const input=dialog.querySelector('input[type="file"]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await run(`[...document.querySelectorAll('dialog[open]')].at(-1).querySelector('input[type="checkbox"]').click()`);await click("确认更新");await until("replacement audit visible",`document.querySelectorAll('dialog[open]').length===1&&document.querySelector('dialog[open]')?.textContent.includes('操作记录')`);
  const replacementDownload=await fetch(origin+`/api/files/${uiFile.file.id}`,{headers:{Cookie:`agile_session=${token}`}});assert.equal(await replacementDownload.text(),"after replacement");assert.equal((await request(`/api/document-nodes/${uiFile.node.id}`)).node.name,"UI替换验收.txt");checks.push("replacement updates old URL atomically and preserves node title");await run(`document.querySelector('dialog[open] header button').click()`);
  await until("directory reloads after replacement",`!![...document.querySelectorAll('.ws-doc-table button')].find(b=>b.textContent==='UI链接验收')`);await click("UI链接验收");await until("link update action loads",`document.querySelector('dialog[open]')?.textContent.includes('修改外部链接')`);await click("修改外部链接");await until("link update dialog loads",`document.querySelectorAll('dialog[open]').length===2`);await run(`(()=>{const d=[...document.querySelectorAll('dialog[open]')].at(-1);const i=d.querySelector('input[type="url"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'https://example.test/after');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await run(`[...document.querySelectorAll('dialog[open]')].at(-1).querySelector('input[type="checkbox"]').click()`);await click("确认更新");await until("link change persists with audit",`document.querySelectorAll('dialog[open]').length===1&&!!document.querySelector('dialog[open] a[href="https://example.test/after"]')&&document.querySelector('dialog[open]').textContent.includes('操作记录')`);await run(`document.querySelector('dialog[open] header button').click()`);
  const pdfJob=await request(`/api/document-spaces/${space.id}/exports`,"POST",{rootId:richNode.id,format:"pdf",requestId:randomUUID()},true,202);let pdfReady=false;for(let i=0;i<60;i++){const list=await request(`/api/document-spaces/${space.id}/exports`);if(list.exports.some(j=>j.id===pdfJob.exportId&&j.state==='completed')){pdfReady=true;break;}await pause(500);}assert.ok(pdfReady);const realPDF=await fetch(origin+`/api/document-exports/${pdfJob.exportId}/file`,{headers:{Cookie:`agile_session=${token}`}});assert.equal(realPDF.status,200);const pdfBytes=Buffer.from(await realPDF.arrayBuffer());assert.equal(pdfBytes.subarray(0,5).toString(),"%PDF-");writeFileSync(path.join(artifacts,"document-export-sample.pdf"),pdfBytes);checks.push("background PDF export contains a real downloadable PDF");
  // Lifecycle HTTP adapters run on a disposable team, never shared manual fixtures.
  const temporaryTeam=(await request('/api/teams','POST',{name:'文档生命周期临时团队'},true,201)).team;
  const temporaryProject=(await request('/api/projects','POST',{teamId:temporaryTeam.id,name:'文档生命周期临时项目',key:'DOCLF',templateSet:'software'},true,201)).project;
  const tempSpace=(await request(`/api/projects/${temporaryProject.id}/document-space`)).space;assert.equal(tempSpace.templateSet,'software');
  const tempRoot=(await request(`/api/document-spaces/${tempSpace.id}/nodes`)).nodes[0];const tempDoc=(await request(`/api/document-spaces/${tempSpace.id}/nodes`,'POST',{kind:'document',parentId:tempRoot.id,name:'归档锁验证',requestId:randomUUID()},true,201)).node;
  const tempLock='f'.repeat(64);await request(`/api/document-nodes/${tempDoc.id}/editor`,'POST',{action:'acquire',lockToken:tempLock});const archiveBlocked=await request(`/api/projects/${temporaryProject.id}`,'PUT',{status:'archived'},true,409);assert.equal(archiveBlocked.code,'DOCUMENT_EDITING');await request(`/api/document-nodes/${tempDoc.id}/editor`,'POST',{action:'release',lockToken:tempLock});await request(`/api/projects/${temporaryProject.id}`,'PUT',{status:'archived'});assert.equal((await request(`/api/document-nodes/${tempDoc.id}`)).space.readOnly,true);await request(`/api/projects/${temporaryProject.id}`,'PUT',{status:'active'});
  const tempForm=new FormData();tempForm.set('file',new File(['old URL survives project deletion'],'转存兼容.txt'));tempForm.set('parentId',String(tempRoot.id));tempForm.set('requestId',randomUUID());const tempUploadResponse=await fetch(origin+`/api/projects/${temporaryProject.id}/files`,{method:'POST',headers:{Cookie:`agile_session=${token}`,Origin:origin},body:tempForm});assert.equal(tempUploadResponse.status,201);const tempUpload=await tempUploadResponse.json();
  const impact=await request(`/api/projects/${temporaryProject.id}/deletion-impact`);await request(`/api/projects/${temporaryProject.id}`,'DELETE',{confirmPermanent:true,expectedActive:impact.active,expectedTrashed:impact.trashed});const transferred=await fetch(origin+`/api/files/${tempUpload.file.id}`,{headers:{Cookie:`agile_session=${token}`}});assert.equal(transferred.status,200);assert.equal(await transferred.text(),'old URL survives project deletion');assert.equal((await request(`/api/document-nodes/${tempDoc.id}`)).space.projectId,null);
  const teamImpact=await request(`/api/teams/${temporaryTeam.id}/deletion-impact`);await request(`/api/teams/${temporaryTeam.id}`,'DELETE',{confirmPermanent:true,expectedActive:teamImpact.active,expectedTrashed:teamImpact.trashed});await request(`/api/document-nodes/${tempDoc.id}`,'GET',null,true,404);checks.push('HTTP project templates, editing archive guard, project transfer, old URL identity and team deletion');
  console.log(JSON.stringify({ passed: checks.length, checks, database: databaseName, screenshot: path.join(artifacts, "document-directory-live.png") }));
} finally {
  if (ws) { try { await call("Browser.close"); } catch {} ws.close(); }
  if (browser) browser.kill();
  try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
  closeSync(log);
  const cleanup = postgres(url.toString(), { max: 1 });
  try { await cleanup`DELETE FROM sessions WHERE token=${token}`; } finally { await cleanup.end(); }
}
