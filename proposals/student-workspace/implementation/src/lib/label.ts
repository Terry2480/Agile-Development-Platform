import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { labels, taskLabels, tasks, type LabelColor } from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { getTeamMembership, requireTeamRole } from "./team";
import { requireTaskWrite } from "./task";

const LABEL_NAME_MAX = 20;

function normalizeName(raw: string) {
  const name = raw.trim();
  if (!name) throw new AppError("标签名不可为空");
  if (name.length > LABEL_NAME_MAX)
    throw new AppError(`标签名不可超过 ${LABEL_NAME_MAX} 字`);
  return name;
}

// 大小写不敏感查重。excludeId 供改名时排除自身。
async function assertNameFree(teamId: string, name: string, excludeId?: string) {
  const rows = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.teamId, teamId), sql`lower(${labels.name}) = lower(${name})`));
  if (rows.some((r) => r.id !== excludeId)) throw new AppError("标签已存在");
}

export async function listTeamLabels(actorId: string, teamId: string) {
  const member = await getTeamMembership(actorId, teamId);
  if (!member) throw new ForbiddenError();
  return db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(eq(labels.teamId, teamId))
    .orderBy(labels.name);
}

export async function createLabel(
  actorId: string,
  teamId: string,
  input: { name: string; color?: LabelColor },
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const name = normalizeName(input.name);
  await assertNameFree(teamId, name);

  try {
    const [label] = await db
      .insert(labels)
      .values({ teamId, name, color: input.color ?? "slate" })
      .returning();
    return label;
  } catch (e) {
    // 查重与插入之间的并发窗口，由唯一约束兜底（同 joinTeam 之形制）
    if (isUniqueViolation(e)) throw new AppError("标签已存在");
    throw e;
  }
}

// 标签管理权限：先由 labelId 取得 teamId，再校验 admin
async function requireLabelAdmin(actorId: string, labelId: string) {
  const [label] = await db.select().from(labels).where(eq(labels.id, labelId));
  if (!label) throw new AppError("标签不存在");
  await requireTeamRole(actorId, label.teamId, ["admin"]);
  return label;
}

export async function renameLabel(
  actorId: string,
  labelId: string,
  patch: { name?: string; color?: LabelColor },
) {
  const label = await requireLabelAdmin(actorId, labelId);
  const name = patch.name === undefined ? undefined : normalizeName(patch.name);
  if (name !== undefined) await assertNameFree(label.teamId, name, labelId);

  const [updated] = await db
    .update(labels)
    .set({
      ...(name !== undefined && { name }),
      ...(patch.color !== undefined && { color: patch.color }),
    })
    .where(eq(labels.id, labelId))
    .returning();
  return updated;
}

export async function deleteLabel(actorId: string, labelId: string) {
  await requireLabelAdmin(actorId, labelId);
  // task_labels 的 cascade 会自动撕下所有贴附
  await db.delete(labels).where(eq(labels.id, labelId));
}

// 全量替换某任务的标签，同构于 lib/task.ts 的 setTaskSuccessors
export async function setTaskLabels(actorId: string, taskId: string, labelIds: string[]) {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await requireTaskWrite(actorId, task.projectId);
  const unique = [...new Set(labelIds)];

  if (unique.length > 0) {
    const owned = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.teamId, access.project.teamId), inArray(labels.id, unique)));
    // 数目对不上即有标签不属本团队——杜绝跨团队挂载
    if (owned.length !== unique.length) throw new AppError("标签不属于该团队");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
    if (unique.length > 0) {
      await tx.insert(taskLabels).values(unique.map((labelId) => ({ taskId, labelId })));
    }
  });
}
