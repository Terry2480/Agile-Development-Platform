import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { conversations, messages as messagesTable } from "@/db/schema";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { listTeamLabels } from "@/lib/label";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";
import { Board } from "./board";
import { ChatPanel } from "./chat-panel";
import { FilterBar } from "./filter-bar";

const PROJECT_TYPE_LABEL: Record<string, string> = {
  course: "课程项目",
  innovation: "大创项目",
  competition: "竞赛项目",
  research: "科研项目",
};

const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  archived: "已归档",
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;

  const [projectMilestones, projectTasks, members, dependencies, teamLabels] = await Promise.all([
    listProjectMilestones(session.user.id, projectId),
    listProjectTasks(session.user.id, projectId),
    listTeamMembers(project.teamId),
    listProjectDependencies(session.user.id, projectId),
    listTeamLabels(session.user.id, project.teamId),
  ]);

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  // 「今日」在服务端按本地时区取 YYYY-MM-DD，随后仅作字符串比较
  const today = new Date().toLocaleDateString("sv-SE");
  const visibleTasks = applyFilters(projectTasks, filters, today);

  const canWrite = role === "admin" || role === "student";
  const isAdmin = role === "admin";

  const [latestConv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  const history = latestConv
    ? await db
        .select({ role: messagesTable.role, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, latestConv.id))
        .orderBy(messagesTable.createdAt)
    : [];

  const initialMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return (
    <main className="mx-auto max-w-6xl space-y-8 py-8">
      <header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ac-badge bg-primary-soft text-primary">
                {PROJECT_TYPE_LABEL[project.projectType] ?? "项目"}
              </span>
              <span
                className={`ac-badge ${
                  project.status === "archived" ? "bg-low-soft text-low" : "bg-done/12 text-done"
                }`}
              >
                {PROJECT_STATUS_LABEL[project.status] ?? project.status}
              </span>
            </div>
            <h1 className="mt-2 truncate font-display text-3xl font-semibold text-ink">
              {project.name}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/projects/${projectId}/documents`} className="ac-btn-ghost whitespace-nowrap">
              项目资料
            </Link>
            <Link href={`/projects/${projectId}/timeline`} className="ac-btn-ghost whitespace-nowrap">
              时间线
            </Link>
          </div>
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-ink-soft">{project.description}</p>
        )}
        <p className="mt-1 text-xs text-ink-faint">
          {project.startDate ?? "未设置开始日期"} ~ {project.endDate ?? "未设置结束日期"}
        </p>
        <nav className="mt-5 flex flex-wrap gap-1 border-b border-line" aria-label="项目导航">
          <Link
            href={`/projects/${projectId}`}
            className="border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"
          >
            项目概览
          </Link>
          <Link
            href={`/projects/${projectId}/documents`}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-ink-soft hover:border-line-strong hover:text-ink"
          >
            项目资料
          </Link>
          <Link
            href={`/projects/${projectId}/timeline`}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-ink-soft hover:border-line-strong hover:text-ink"
          >
            时间线
          </Link>
        </nav>
      </header>

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin}
      />

      <section className="space-y-3">
        <h2 className="font-medium text-ink">看板</h2>
        <FilterBar
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          visible={visibleTasks.length}
          total={projectTasks.length}
        />
        <Board
          projectId={projectId}
          groupBy={filters.group}
          tasks={visibleTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            completionNote: t.completionNote,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            dueDate: t.dueDate,
            assigneeName: t.assigneeName,
            assigneeId: t.assigneeId,
            milestoneId: t.milestoneId,
            labels: t.labels,
          }))}
          canWrite={canWrite}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          dependencies={dependencies}
        />
      </section>

      <ChatPanel
        projectId={projectId}
        initialMessages={initialMessages}
        members={members}
        milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
      />

      {canWrite && (
        <NewTaskForm
          projectId={projectId}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
        />
      )}
    </main>
  );
}
