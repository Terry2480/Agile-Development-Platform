// 飞书 interactive 卡片模板。卡片 JSON schema 以飞书官方文档核验字段名。
const SITE = () => process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// 深链：飞书内点击 → JSSDK 免登 → 项目页 ?task= 自动打开任务弹窗
function taskUrl(projectId: string, taskId: string): string {
  return `${SITE()}/projects/${projectId}?task=${taskId}`;
}

export type CardTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
  completionNote?: string | null;
};

function field(content: string, isShort = true) {
  return { is_short: isShort, text: { tag: "lark_md", content } };
}

function detailButton(projectId: string, taskId: string, label = "查看详情") {
  return {
    tag: "action",
    actions: [
      { tag: "button", text: { tag: "plain_text", content: label }, url: taskUrl(projectId, taskId), type: "primary" },
    ],
  };
}

export function buildAssignedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: "🎯 新任务指派" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**负责人**\n${t.assigneeName ?? "未分配"}`),
        field(`**截止**\n${t.dueDate ?? "未设"}`),
        field(`**优先级**\n${t.priority}`),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

export function buildCompletedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "green", title: { tag: "plain_text", content: "✅ 任务完成" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**完成情况**\n${t.completionNote ?? "—"}`, false),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

export type ReminderItem = { id: string; title: string; projectId: string };

export function buildDueReminderCard(input: { overdue: ReminderItem[]; dueSoon: ReminderItem[] }) {
  const line = (i: ReminderItem) => `- [${i.title}](${taskUrl(i.projectId, i.id)})`;
  const elements: unknown[] = [];
  if (input.overdue.length) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**逾期未完成**\n${input.overdue.map(line).join("\n")}` } });
  }
  if (input.dueSoon.length) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**即将到期**\n${input.dueSoon.map(line).join("\n")}` } });
  }
  return {
    config: { wide_screen_mode: true },
    header: { template: "orange", title: { tag: "plain_text", content: "⏰ 任务提醒" } },
    elements,
  };
}
