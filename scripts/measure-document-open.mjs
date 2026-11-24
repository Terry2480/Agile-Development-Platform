// 「打开云文档」性能对照：把改前链路（先问空间、再问目录）等价重放，与改后的聚合请求对比。
// 用法：node scripts/measure-document-open.mjs [迭代次数]
// 环境变量：DOCUMENT_MEASURE_ORIGIN / DOCUMENT_MEASURE_EMAIL / DOCUMENT_MEASURE_PASSWORD / DOCUMENT_MEASURE_PROJECT
//
// 说明：两次测量共用同一台机器与同一个已编译的服务，避免"改前在别的环境跑"这种不可比数据。
// 改前链路按原实现原样串行发出（/document-space 之后再 /nodes），改后只发一个聚合请求；
// 下面的断言会验证两者拿到的列表内容逐字节一致，所以对照的是"同样的数据、不同的往返次数"。
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const origin = process.env.DOCUMENT_MEASURE_ORIGIN ?? "http://localhost:3113";
const email = process.env.DOCUMENT_MEASURE_EMAIL ?? "document-review@example.test";
const password = process.env.DOCUMENT_MEASURE_PASSWORD ?? "DocReview2026!";
const iterations = Number(process.argv[2] ?? 20);

let cookie = "";
async function request(path) {
  const started = performance.now();
  const response = await fetch(origin + path, { headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  const text = await response.text();
  const elapsed = performance.now() - started;
  for (const value of response.headers.getSetCookie?.() ?? []) {
    const pair = value.split(";")[0];
    if (pair.startsWith("agile_session=")) cookie = pair;
  }
  if (!response.ok) throw new Error(`${path} → ${response.status} ${text.slice(0, 120)}`);
  return { json: JSON.parse(text), bytes: Buffer.byteLength(text), elapsed };
}

const login = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`登录失败：${login.status}`);
for (const value of login.headers.getSetCookie?.() ?? []) {
  const pair = value.split(";")[0];
  if (pair.startsWith("agile_session=")) cookie = pair;
}

const projects = (await request("/api/projects")).json.projects;
const project = process.env.DOCUMENT_MEASURE_PROJECT
  ? projects.find(item => String(item.id) === process.env.DOCUMENT_MEASURE_PROJECT)
  : projects[0];
if (!project) throw new Error("没有可用项目");

const listQuery = "sort=updated&limit=50";
const samples = { spaceOnly: [], listOnly: [], legacySerial: [], aggregate: [], tree: [] };
const bytes = { spaceOnly: 0, listOnly: 0, aggregate: 0, tree: 0 };
let spaceId = null;
let equivalence = false;

// 预热：dev 模式首次编译、首个请求建立连接，不计入统计。
for (let warm = 0; warm < 3; warm++) {
  const opened = await request(`/api/projects/${project.id}/document-space`);
  spaceId = opened.json.space.id;
  await request(`/api/document-spaces/${spaceId}/nodes?${listQuery}`);
  await request(`/api/projects/${project.id}/document-space?${listQuery}&include=listing`);
}

for (let index = 0; index < iterations; index++) {
  // 交替顺序，避免固定顺序带来的系统性偏差（例如后跑的请求正好赶上 GC 或连接池空闲）。
  const legacyFirst = index % 2 === 0;
  if (legacyFirst) {
    const first = await request(`/api/projects/${project.id}/document-space`);
    const second = await request(`/api/document-spaces/${first.json.space.id}/nodes?${listQuery}`);
    samples.spaceOnly.push(first.elapsed);
    samples.listOnly.push(second.elapsed);
    samples.legacySerial.push(first.elapsed + second.elapsed);
    bytes.spaceOnly = first.bytes;
    bytes.listOnly = second.bytes;
    spaceId = first.json.space.id;

    const merged = await request(`/api/projects/${project.id}/document-space?${listQuery}&include=listing`);
    samples.aggregate.push(merged.elapsed);
    bytes.aggregate = merged.bytes;
    equivalence = JSON.stringify(merged.json.listing) === JSON.stringify(second.json);

    const tree = await request(`/api/document-spaces/${spaceId}/nodes?foldersOnly=1&sort=name&limit=50`);
    samples.tree.push(tree.elapsed);
    bytes.tree = tree.bytes;
  } else {
    const merged = await request(`/api/projects/${project.id}/document-space?${listQuery}&include=listing`);
    const first = await request(`/api/projects/${project.id}/document-space`);
    const second = await request(`/api/document-spaces/${first.json.space.id}/nodes?${listQuery}`);
    const tree = await request(`/api/document-spaces/${first.json.space.id}/nodes?foldersOnly=1&sort=name&limit=50`);
    samples.aggregate.push(merged.elapsed);
    samples.spaceOnly.push(first.elapsed);
    samples.listOnly.push(second.elapsed);
    samples.legacySerial.push(first.elapsed + second.elapsed);
    samples.tree.push(tree.elapsed);
    bytes.aggregate = merged.bytes;
    bytes.spaceOnly = first.bytes;
    bytes.listOnly = second.bytes;
    bytes.tree = tree.bytes;
    equivalence = JSON.stringify(merged.json.listing) === JSON.stringify(second.json);
  }
}

const round = value => Math.round(value * 100) / 100;
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = ratio => {
    // 最近秩法：p95 用第 ceil(0.95×n) 小的样本，而不是直接落在最大值上。
    const rank = Math.max(1, Math.ceil(sorted.length * ratio));
    return sorted[Math.min(sorted.length - 1, rank - 1)];
  };
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { min: round(sorted[0]), median: round(median), p95: round(percentile(0.95)), max: round(sorted.at(-1)) };
};

const table = Object.entries(samples).map(([key, values]) => ({ scene: key, ...stats(values), bytes: bytes[key] ?? "-" }));
console.log(`项目：${project.name}（${project.id}）　样本：${iterations} 次　目标：${origin}\n`);
console.log("| 场景 | min(ms) | 中位数(ms) | p95(ms) | max(ms) | 响应字节 |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const row of table) console.log(`| ${row.scene} | ${row.min} | ${row.median} | ${row.p95} | ${row.max} | ${row.bytes} |`);

const seri = stats(samples.legacySerial), merged = stats(samples.aggregate);
const paired = samples.legacySerial.map((value, index) => value - samples.aggregate[index]);
const pairedStats = stats(paired);
console.log(`\n关键路径：改前 ${seri.median}ms（2 轮串行） → 改后 ${merged.median}ms（1 轮）`);
// 配对差值：同一轮里"改前链路 - 改后聚合"，比两个中位数相减更抗单次抖动。
console.log(`配对差值：中位数 ${pairedStats.median}ms（min ${pairedStats.min} / p95 ${pairedStats.p95} / max ${pairedStats.max}）`);
console.log(`服务端总工作量是否一致：spaceOnly.p50=${stats(samples.spaceOnly).median}ms + listOnly.p50=${stats(samples.listOnly).median}ms = ${round(stats(samples.spaceOnly).median + stats(samples.listOnly).median)}ms，聚合 ${merged.median}ms（差 ${round(stats(samples.spaceOnly).median + stats(samples.listOnly).median - merged.median)}ms ≈ 一次请求的固定开销）`);
console.log(`进入时总请求数：改前 3（空间 + 目录 + 目录树） → 改后 2（聚合 + 目录树）`);
console.log(`聚合响应字节 ${bytes.aggregate} vs 分离之和 ${bytes.spaceOnly + bytes.listOnly}（差 ${bytes.aggregate - bytes.spaceOnly - bytes.listOnly}）`);
console.log(`列表内容与目录接口逐字节一致：${equivalence ? "是" : "否"}`);

const rtts = [20, 80, 150, 400];
console.log("\n按网络往返折算（每少一轮 RTT 的收益 = RTT）：");
console.log("| RTT | 改前关键路径 | 改后关键路径 | 节省 | 比例 |");
console.log("| ---: | ---: | ---: | ---: | ---: |");
for (const rtt of rtts) {
  const before = seri.median + 2 * rtt;
  const after = merged.median + rtt;
  console.log(`| ${rtt}ms | ${round(before)}ms | ${round(after)}ms | ${round(before - after)}ms | ${Math.round((1 - after / before) * 100)}% |`);
}

const ok = equivalence && merged.median < seri.median;
process.exit(ok ? 0 : 1);
