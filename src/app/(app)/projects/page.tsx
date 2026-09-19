import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";

const TYPE_LABEL: Record<string, string> = {
  course: "课程项目",
  innovation: "大创项目",
  competition: "竞赛项目",
  research: "科研项目",
};

const TYPE_TONE: Record<string, string> = {
  course: "bg-primary-soft text-primary",
  innovation: "bg-accent-soft text-accent",
  competition: "bg-high-soft text-high",
  research: "bg-done/12 text-done",
};

export default async function AllProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const projects = await listMyProjects(session.user.id);

  const activeProjects = projects.filter((p) => p.status === "active").length;
  const totalTasks = projects.reduce((sum, p) => sum + p.taskTotal, 0);
  const completedTasks = projects.reduce((sum, p) => sum + p.doneCount, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-8 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">学生项目工作台</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-ink">我的项目</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-soft">
            把项目资料、任务进度和最终成果放在同一个空间里。
          </p>
        </div>
        <Link href="/teams" className="ac-btn whitespace-nowrap">
          管理团队与项目
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="项目统计">
        <Stat label="进行中的项目" value={activeProjects} suffix="个" />
        <Stat label="全部任务" value={totalTasks} suffix="项" />
        <Stat
          label="已完成任务"
          value={completedTasks}
          suffix={totalTasks > 0 ? ` / ${totalTasks}` : "项"}
        />
      </section>

      {projects.length === 0 ? (
        <section className="ac-card overflow-hidden">
          <div className="border-b border-line bg-sunken/50 px-6 py-5">
            <p className="text-sm font-semibold text-ink">从一个真实项目开始</p>
            <p className="mt-1 text-sm text-ink-soft">
              选择团队后，可以用课程、大创、竞赛或科研模板创建项目。
            </p>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["course", "课程项目", "适合课程作业、交互设计和软件工程项目"],
              ["innovation", "大创项目", "适合长期研究、实验和阶段汇报"],
              ["competition", "竞赛项目", "适合蓝桥杯、计算机设计大赛等比赛"],
              ["research", "科研项目", "适合论文、实验和研究资料沉淀"],
            ].map(([type, title, description]) => (
              <div key={type} className="bg-surface p-5">
                <span className={`ac-badge ${TYPE_TONE[type]}`}>{title}</span>
                <p className="mt-3 text-sm leading-6 text-ink-soft">{description}</p>
              </div>
            ))}
          </div>
          <div className="px-6 py-5">
            <Link href="/teams" className="ac-btn">
              去创建或加入团队
            </Link>
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-ink">最近项目</h2>
            <span className="text-xs text-ink-faint">共 {projects.length} 个项目</span>
          </div>
          <ul className="grid gap-4 md:grid-cols-2">
            {projects.map((p) => {
              const pct = p.taskTotal > 0 ? Math.round((p.doneCount / p.taskTotal) * 100) : 0;
              const type = p.projectType ?? "course";
              return (
                <li key={p.id} className="ac-card group p-5 transition-shadow hover:shadow-pop">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`ac-badge ${TYPE_TONE[type] ?? TYPE_TONE.course}`}>
                          {TYPE_LABEL[type] ?? "项目"}
                        </span>
                        {p.status === "archived" ? (
                          <span className="ac-badge bg-low-soft text-low">已归档</span>
                        ) : (
                          <span className="ac-badge bg-done/12 text-done">进行中</span>
                        )}
                      </div>
                      <Link
                        href={`/projects/${p.id}`}
                        className="mt-3 block truncate font-display text-xl font-semibold text-ink group-hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      <p className="mt-1 text-xs text-ink-faint">{p.teamName}</p>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums text-primary">{pct}%</span>
                  </div>

                  <div className="mt-5">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-ink-soft">
                      <span>任务完成度</span>
                      <span className="tabular-nums">
                        {p.doneCount}/{p.taskTotal}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full bg-done transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                    <Link href={`/projects/${p.id}`} className="ac-btn-ghost">
                      打开项目
                    </Link>
                    <Link href={`/projects/${p.id}/documents`} className="ac-btn-ghost">
                      项目资料
                    </Link>
                    <Link href={`/projects/${p.id}/timeline`} className="ac-btn-ghost">
                      时间线
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="ac-card p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
        {value}
        <span className="ml-1 text-sm font-normal text-ink-faint">{suffix}</span>
      </p>
    </div>
  );
}
