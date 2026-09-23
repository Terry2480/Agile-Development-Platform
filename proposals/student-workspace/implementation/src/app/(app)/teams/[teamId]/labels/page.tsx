import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { labels, taskLabels, teams } from "@/db/schema";
import { getTeamMembership } from "@/lib/team";
import { listTeamLabels } from "@/lib/label";
import { NewLabelForm, LabelRow } from "./label-forms";

export default async function LabelsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  // teamId 来自 URL，非法 uuid 提前拦截，语义等同「不存在」
  if (!z.uuid().safeParse(teamId).success) notFound();

  // 访问者必须是团队成员（非成员 404，不泄露团队存在性）
  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  const list = await listTeamLabels(session.user.id, teamId);

  const usageRows = await db
    .select({ labelId: taskLabels.labelId, count: sql<number>`count(*)::int` })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(eq(labels.teamId, teamId))
    .groupBy(taskLabels.labelId);
  const usage = new Map(usageRows.map((r) => [r.labelId, r.count]));

  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-2xl space-y-6 py-8">
      <h1 className="font-display text-2xl font-semibold text-ink">{team.name} · 标签</h1>
      <p className="text-sm text-ink-soft">
        标签为团队共用，可贴在任意项目的任务上，用于筛选与分组。
        {!isAdmin && "（仅团队管理员可增删改）"}
      </p>

      {isAdmin && <NewLabelForm teamId={teamId} />}

      {list.length === 0 ? (
        <p className="text-sm text-ink-faint">尚无标签。</p>
      ) : (
        <ul className="space-y-2">
          {list.map((l) => (
            <LabelRow
              key={l.id}
              teamId={teamId}
              label={l}
              usage={usage.get(l.id) ?? 0}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
