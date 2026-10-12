import path from "node:path";
import { unlink } from "node:fs/promises";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, fileCleanup } from "@/db/schema";

export function uploadPath(storedName: string) {
  if (!storedName || storedName === "." || storedName === ".." || /[\\/:\x00]/.test(storedName)) throw new Error("Invalid stored filename");
  const root = path.resolve(process.cwd(), "uploads");
  const target = path.resolve(root, storedName);
  if (path.dirname(target) !== root) throw new Error("File outside uploads directory");
  return target;
}

// 失败和崩溃后的清理记录独立于附件外键，项目删除后仍能重试。
export async function drainFileCleanup(limit = 50) {
  for (let i = 0; i < limit; i++) {
    const found = await db.transaction(async (tx) => {
      const [job] = await tx.select().from(fileCleanup).where(lte(fileCleanup.notBefore, new Date())).limit(1).for("update", { skipLocked: true });
      if (!job) return false;
      const [live] = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.storedName, job.storedName)).limit(1);
      if (live) { await tx.delete(fileCleanup).where(eq(fileCleanup.storedName, job.storedName)); return true; }
      try {
        await unlink(uploadPath(job.storedName)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        await tx.delete(fileCleanup).where(eq(fileCleanup.storedName, job.storedName));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code || "CLEANUP_FAILED";
        await tx.update(fileCleanup).set({ attempts: sql`${fileCleanup.attempts} + 1`, lastError: code, notBefore: new Date(Date.now() + 60000) })
          .where(and(eq(fileCleanup.storedName, job.storedName), eq(fileCleanup.attempts, job.attempts)));
      }
      return true;
    });
    if (!found) break;
  }
}

export async function tryFileCleanup() {
  try { await drainFileCleanup(); } catch { console.error("[file-cleanup] 清理暂时失败，将在下次重试"); }
}
