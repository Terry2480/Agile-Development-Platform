import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { ForbiddenError } from "@/lib/errors";
import type { TaskStatus } from "@/db/schema";

// 上限放宽至 4000：快照须随行携带 uuid（成员/里程碑/任务各 36 字符）供写工具填参，
// 旧的 2000 字符下十余个任务即触发降级，模型只得反复调读工具，反更耗 token。
const SNAPSHOT_CHAR_LIMIT = 4000;
// 任务明细至多列此数，余者提示模型用 list_tasks 现查
const TASK_LIST_LIMIT = 40;

export async function buildProjectSnapshot(actorId: string, projectId: string): Promise<string> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const { project } = access;

  const [milestones, tasks, members] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    listProjectTasks(actorId, projectId),
    listTeamMembers(project.teamId),
  ]);

  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const t of tasks) byStatus[t.status]++;

  // 当日日期：模型不知今夕何夕，缺此则「下周五截止」一类相对日期必错。
  // 取法同 notify.ts:103（toISOString 前十位），全军一律。
  const today = new Date().toISOString().slice(0, 10);

  const head = [
    `今天是 ${today}（相对日期以此为准推算）`,
    `# 当前项目：${project.name}（projectId=${project.id}）`,
    project.description ? `描述：${project.description}` : null,
    `状态：${project.status}；起止：${project.startDate ?? "?"} ~ ${project.endDate ?? "?"}`,
    `任务统计：共 ${tasks.length} 个（待办 ${byStatus.todo} / 进行中 ${byStatus.doing} / 已完成 ${byStatus.done}）`,
    `共 ${milestones.length} 个里程碑`,
  ]
    .filter(Boolean)
    .join("\n");

  // 成员段恒保留：assigneeId 只能取自此处，且无 list_members 读工具可兜底
  const memberBlock =
    "\n\n## 成员（assigneeId 只能取此处的 id）\n" +
    members.map((m) => `- ${m.name}｜${m.role}｜id=${m.id}`).join("\n");

  const milestoneBlock =
    milestones.length > 0
      ? "\n\n## 里程碑（milestoneId 取此处的 id）\n" +
        milestones
          .map(
            (m) =>
              `- ${m.title}｜${m.status}${m.targetDate ? `｜目标 ${m.targetDate}` : ""}｜id=${m.id}`,
          )
          .join("\n")
      : "";

  const shownTasks = tasks.slice(0, TASK_LIST_LIMIT);
  const taskBlock =
    shownTasks.length > 0
      ? "\n\n## 任务（taskId 取此处的 id）\n" +
        shownTasks
          .map(
            (t) =>
              `- [${t.status}] ${t.title}｜${t.assigneeName ?? "未指派"}｜${t.dueDate ?? "无截止"}｜id=${t.id}`,
          )
          .join("\n") +
        (tasks.length > shownTasks.length
          ? `\n（另有 ${tasks.length - shownTasks.length} 个未列出，需要时调 list_tasks 现查）`
          : "")
      : "";

  // 逐层降级：先弃任务明细（list_tasks 可兜底），再弃里程碑明细（list_milestones 可兜底）；
  // 统计头与成员段恒保留——后者无读工具可补。
  const full = head + memberBlock + milestoneBlock + taskBlock;
  if (full.length <= SNAPSHOT_CHAR_LIMIT) return full;

  const withoutTasks = head + memberBlock + milestoneBlock;
  if (withoutTasks.length <= SNAPSHOT_CHAR_LIMIT) return withoutTasks;

  return head + memberBlock;
}
