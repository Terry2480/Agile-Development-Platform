import type { DocumentKind } from "@/db/schema";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  custom: "自定义",
  proposal: "开题材料",
  meeting: "会议纪要",
  weekly: "周报",
  research: "研究记录",
};

export const DOCUMENT_TEMPLATES: Record<DocumentKind, string> = {
  custom: "",
  proposal: "# 项目开题\n\n## 背景与问题\n\n## 用户与需求\n\n## 计划与分工\n\n## 预期成果\n",
  meeting: "# 会议纪要\n\n日期：\n参与成员：\n\n## 讨论内容\n\n## 决策\n\n## 待办任务\n",
  weekly: "# 项目周报\n\n周期：\n本周完成：\n\n## 当前进展\n\n## 遇到的问题\n\n## 下周计划\n",
  research: "# 研究记录\n\n日期：\n实验/调研主题：\n\n## 方法\n\n## 观察与数据\n\n## 结论与下一步\n",
};

export function getDocumentTemplate(kind: DocumentKind) {
  return DOCUMENT_TEMPLATES[kind];
}
