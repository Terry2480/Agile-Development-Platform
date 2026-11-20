import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamInvites } from "@/db/schema";
import { requireUser, requireTeamAccess, parseId, ApiError, handleApiError } from "@/lib/api";
import { canManageInvites } from "@/lib/team-invites";
type Context = { params: Promise<{ id: string }> };
async function access(request: Request, context: Context) {
  const user = await requireUser(request);
  const id = parseId((await context.params).id);
  const { membership } = await requireTeamAccess(user.id, id);
  if (!canManageInvites(membership)) throw new ApiError(403, "只有负责人或管理员可以管理邀请码");
  return id;
}
export async function GET(request: Request, context: Context) {
  try { const id = await access(request, context); const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.teamId, id)); return Response.json({ invite: invite ?? null }); } catch (e) { return handleApiError(e); }
}
export async function POST(request: Request, context: Context) {
  try {
    const teamId = await access(request, context);
    const value = { teamId, code: randomBytes(8).toString("hex").toUpperCase(), expiresAt: new Date(Date.now() + 7 * 86400000) };
    const [invite] = await db.insert(teamInvites).values(value).onConflictDoUpdate({ target: teamInvites.teamId, set: { code: value.code, expiresAt: value.expiresAt } }).returning();
    return Response.json({ invite });
  } catch (e) { return handleApiError(e); }
}
export async function DELETE(request: Request, context: Context) {
  try { const id = await access(request, context); await db.delete(teamInvites).where(eq(teamInvites.teamId, id)); return Response.json({ ok: true }); } catch (e) { return handleApiError(e); }
}
