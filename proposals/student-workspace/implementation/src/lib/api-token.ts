import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { AppError } from "./errors";

const TOKEN_PREFIX = "ac_";

// 高熵随机 token：256 bit，base64url 无填充。前缀便于识别与快速否决伪造。
function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

// 高熵 token 用 sha256（快、可建唯一索引供 O(1) 查验）；不同于低熵密码需慢哈希 bcrypt。
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// 生成新令牌。明文只此一次返回，库中仅存 hash。
export async function createApiToken(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError("令牌名称不能为空");

  const raw = generateRawToken();
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name: trimmed, tokenHash: hashToken(raw) })
    .returning({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt });

  return { id: row.id, name: row.name, createdAt: row.createdAt, token: raw };
}

// 校验明文 token，命中未撤销者返回 userId 并刷新 lastUsedAt；否则 null。
// 外部写入的认证入口——不信任输入，畸形/伪造/撤销一律 null。
export async function verifyApiToken(rawToken: string): Promise<string | null> {
  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) return null;

  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId, revokedAt: apiTokens.revokedAt })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(rawToken)));
  if (!row || row.revokedAt) return null;

  await db.update(apiTokens).set({ lastUsedAt: sql`now()` }).where(eq(apiTokens.id, row.id));
  return row.userId;
}

// 列举本人令牌（含已撤销，供 UI 标注状态）；绝不含明文或 hash。
export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

// 撤销本人某令牌（软删：置 revokedAt）。越权（他人令牌）或已撤销/不存在一律拒。
export async function revokeApiToken(userId: string, id: string) {
  const [updated] = await db
    .update(apiTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });
  if (!updated) throw new AppError("令牌不存在或已撤销");
}
