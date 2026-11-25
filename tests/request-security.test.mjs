import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequestOrigin, sessionCookie } from "../lib/request-security.ts";
function request(origin, method = "POST", target = "https://app.example.com/api/tasks") {
  return new Request(target, { method, headers: origin ? { origin } : {} });
}
test("production cookies are secure, including cookie deletion; dev cookies work over HTTP", () => {
  assert.match(sessionCookie("token", 604800, true), /; Secure$/);
  assert.match(sessionCookie("", 0, true), /Max-Age=0.*Secure/);
  assert.ok(!sessionCookie("token", 604800, false).includes("Secure"));
});
test("exact trusted origins only, including scheme and port", () => {
  assert.equal(checkRequestOrigin(request("https://app.example.com"), true, "https://app.example.com"), null);
  for (const origin of ["https://app.example.com.attacker.com", "http://app.example.com", "https://app.example.com:8443", "null", null]) assert.equal(checkRequestOrigin(request(origin), true, "https://app.example.com").status, 403);
});
test("fails closed on missing production configuration, without blocking reads", () => {
  assert.equal(checkRequestOrigin(request("https://app.example.com"), true, "").status, 503);
  assert.equal(checkRequestOrigin(request(null, "GET"), true, ""), null);
  assert.equal(checkRequestOrigin(request("http://localhost:3000", "POST", "http://localhost:3000/api/tasks"), false, ""), null);
});
test("referer fallback is checked and invalid configuration is rejected", () => {
  const req = new Request("https://app.example.com/api/tasks", { method: "DELETE", headers: { referer: "https://app.example.com/project/1" } });
  assert.equal(checkRequestOrigin(req, true, "https://app.example.com"), null);
  assert.equal(checkRequestOrigin(req, true, "https://app.example.com/").status, 503);
});
test("开发环境不会因为遗留白名单拒绝同源写请求", () => {
  // 回归：.env.local 里残留 AUTH_ALLOWED_ORIGINS=http://localhost:3113 时，
  // 本地 localhost:3000 上的保存操作曾被 403「不允许来自该网站的操作请求」拦掉。
  const stale = "http://localhost:3113,http://127.0.0.1:3113";
  assert.equal(checkRequestOrigin(request("http://localhost:3000", "POST", "http://localhost:3000/api/users/me"), false, stale), null);
  assert.equal(checkRequestOrigin(request("http://192.168.1.5:3000", "POST", "http://192.168.1.5:3000/api/users/me"), false, stale), null);
  // 跨源请求在开发环境同样拒绝
  assert.equal(checkRequestOrigin(request("http://evil.example", "POST", "http://localhost:3000/api/users/me"), false, stale).status, 403);
});
