import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeamMembership } from "@/lib/team";
import { listTeamProjects } from "@/lib/project";
import { ProjectForm } from "./project-form";

const PROJECT_TYPE_LABEL: Record<string, string> = {
  course: "课程项目",
  innovation: "大创项目",
  competition: "竞赛项目",
  research: "科研项目",
};

export default async function ProjectsPage({
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

  const projects = await listTeamProjects(session.user.id, teamId);
  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-4xl space-y-8 py-8">
      <header>
        <p className="text-sm font-medium text-primary">团队空间</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">团队项目</h1>
        <p className="mt-1 text-sm text-ink-soft">选择一个项目，继续推进任务、资料和阶段节点。</p>
      </header>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="ac-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="ac-badge bg-primary-soft text-primary">
                    {PROJECT_TYPE_LABEL[p.projectType] ?? "项目"}
                  </span>
                  <span className="ac-badge bg-done/12 text-done">
                    {p.status === "archived" ? "已归档" : "进行中"}
                  </span>
                </div>
                <Link
                  href={`/projects/${p.id}`}
                  className="mt-2 block truncate font-display text-lg font-semibold text-ink hover:text-primary"
                >
                  {p.name}
                </Link>
                {(p.startDate || p.endDate) && (
                  <p className="mt-1 text-xs text-ink-faint">
                    {p.startDate ?? "未设置开始日期"} ~ {p.endDate ?? "未设置结束日期"}
                  </p>
                )}
                {p.description && <p className="mt-2 text-sm text-ink-soft">{p.description}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={`/projects/${p.id}`} className="ac-btn-ghost">
                  打开项目
                </Link>
                <Link href={`/projects/${p.id}/documents`} className="ac-btn-ghost">
                  项目资料
                </Link>
              </div>
            </div>
          </li>
        ))}
        {projects.length === 0 && (
          <li className="text-sm text-ink-soft">
            暂无项目{isAdmin ? "，在下方创建第一个。" : "。"}
          </li>
        )}
      </ul>
      {isAdmin && <ProjectForm teamId={teamId} />}
    </main>
  );
}
