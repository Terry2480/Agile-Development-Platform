// 云文档的短期缓存：既服务"hover 图标时的预取"，也服务"目录树的跨挂载复用"。
// 纯逻辑，不依赖 React 和网络：请求函数与数据都由调用方注入，便于单测。
// 只认"刚刚取到"的结果，过期即不再命中；读取(peek)不修改状态，写入时才做过期与容量整理。
type Entry = { at: number; ttl: number; promise: Promise<unknown>; data?: unknown };

const DEFAULT_TTL = 60_000;
const DEFAULT_MAX = 40;

let defaultTtl = DEFAULT_TTL;
let max = DEFAULT_MAX;
let entries = new Map<string, Entry>();

// 仅供测试与登出清理使用。
export function resetPrefetch(options: { ttlMs?: number; max?: number } = {}) {
  entries = new Map();
  defaultTtl = options.ttlMs ?? DEFAULT_TTL;
  max = options.max ?? DEFAULT_MAX;
}

export function entryCount() {
  return entries.size;
}

function trim() {
  while (entries.size > max) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

// 预取：同一个键在有效期内不会重复发请求；失败即丢弃，避免把一次失败当成"已预热"。
export function startPrefetch(key: string, request: () => Promise<unknown>, now = Date.now(), ttlMs = defaultTtl) {
  const existing = entries.get(key);
  if (existing && now - existing.at < existing.ttl) return existing;
  const entry: Entry = { at: now, ttl: ttlMs, promise: request() };
  entries.set(key, entry);
  entry.promise.then(
    data => { if (entries.get(key) === entry) entry.data = data; },
    () => { if (entries.get(key) === entry) entries.delete(key); },
  );
  trim();
  return entry;
}

// 已经取到的结果直接放进缓存（目录树等跨挂载复用）。
export function putCached(key: string, data: unknown, now = Date.now(), ttlMs = defaultTtl) {
  entries.set(key, { at: now, ttl: ttlMs, promise: Promise.resolve(data), data });
  trim();
}

function fresh<T>(key: string, maxAgeMs: number, now: number) {
  const entry = entries.get(key);
  if (!entry || entry.data === undefined) return null;
  const age = now - entry.at;
  return age < Math.min(entry.ttl, maxAgeMs) ? { data: entry.data as T, age } : null;
}

// 只在"已经拿到数据、且没超过 maxAgeMs"时返回；未完成的预取不算命中。
export function peekPrefetch<T>(key: string, maxAgeMs: number, now = Date.now()) {
  return fresh<T>(key, maxAgeMs, now);
}
export function peekCached<T>(key: string, maxAgeMs: number, now = Date.now()) {
  return fresh<T>(key, maxAgeMs, now);
}

// 写操作之后按前缀作废：前缀按"键的一段"匹配（"tree:1:9" 不会误伤 "tree:1:90"）。
export function clearCached(prefix: string) {
  const boundary = prefix.endsWith(":") ? prefix : `${prefix}:`;
  for (const key of [...entries.keys()]) if (key.startsWith(boundary)) entries.delete(key);
}
