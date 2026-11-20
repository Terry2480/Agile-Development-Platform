import Link from "next/link";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getTeamMembership } from "@/lib/team";
import { listTeamResourceUsages } from "@/lib/resource";
import { ResourceForm } from "./resource-form";
import { endResourceAction } from "./actions";

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export default async function ResourcesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!z.uuid().safeParse(teamId).success) notFound();
  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  const { usages, byUser, byResource } = await listTeamResourceUsages(session.user.id, teamId);
  const active = usages.filter((u) => u.active);
  const canEnd = (userId: string) => userId === session.user.id || me.role === "admin";

  return (
    <main className="mx-auto max-w-3xl space-y-8 py-8">
      <header className="space-y-1">
        <Link href="/teams" className="text-xs text-ink-soft hover:text-primary">
          ← 我的团队
        </Link>
        <h1 className="font-display text-2xl font-semibold text-ink">{team.name} · 资源占用</h1>
        <p className="text-sm text-ink-soft">
          登记谁在何时占用了哪项共享资源。当前{" "}
          <span className="font-medium text-doing">{active.length}</span> 项占用中。
        </p>
      </header>

      <ResourceForm teamId={teamId} />

      {/* 时长汇总 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard title="按成员用时" rows={byUser.map((r) => ({ label: r.userName, minutes: r.totalMinutes }))} />
        <StatCard title="按资源用时" rows={byResource.map((r) => ({ label: r.resourceName, minutes: r.totalMinutes }))} />
      </div>

      {/* 占用记录 */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">占用记录</h2>
        {usages.length === 0 ? (
          <div className="ac-card p-8 text-center text-sm text-ink-soft">
            暂无占用记录——用上方表单登记第一条。
          </div>
        ) : (
          <ul className="space-y-2">
            {usages.map((u) => (
              <li
                key={u.id}
                className={`ac-card flex items-center justify-between gap-4 p-4 ${
                  u.active ? "border-l-4 border-l-doing" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{u.resourceName}</span>
                    {u.active ? (
                      <span className="ac-badge bg-doing/12 text-doing">占用中</span>
                    ) : (
                      <span className="ac-badge bg-low-soft text-low">{fmtDuration(u.durationMinutes!)}</span>
                    )}
                    {u.purpose && <span className="text-xs text-ink-faint">· {u.purpose}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {u.userName} · {fmtTime(u.startTime)}
                    {u.endTime ? ` → ${fmtTime(u.endTime)}` : " 起"}
                  </p>
                </div>
                {u.active && canEnd(u.userId) && (
                  <form action={endResourceAction}>
                    <input type="hidden" name="teamId" value={teamId} />
                    <input type="hidden" name="usageId" value={u.id} />
                    <button className="ac-btn-ghost whitespace-nowrap">结束占用</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; minutes: number }[];
}) {
  return (
    <div className="ac-card p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-faint">尚无已结束的占用</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between text-sm">
              <span className="truncate text-ink-soft">{r.label}</span>
              <span className="ml-2 shrink-0 font-medium tabular-nums text-ink">
                {fmtDuration(r.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
