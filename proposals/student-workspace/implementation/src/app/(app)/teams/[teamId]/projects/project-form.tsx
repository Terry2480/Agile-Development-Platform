"use client";

import { useState } from "react";
import { createProjectAction, type FormState } from "./actions";

const TEMPLATES = {
  course: {
    label: "课程项目",
    name: "课程项目 · 未命名",
    description: "围绕课程目标完成调研、设计、开发与最终展示。",
  },
  innovation: {
    label: "大创项目",
    name: "大创项目 · 未命名",
    description: "记录研究目标、阶段成果、实验过程与指导反馈。",
  },
  competition: {
    label: "竞赛项目",
    name: "竞赛项目 · 未命名",
    description: "围绕比赛节点推进选题、开发、测试、材料与答辩。",
  },
  research: {
    label: "科研项目",
    name: "科研项目 · 未命名",
    description: "沉淀问题、方法、实验记录、论文材料和项目成果。",
  },
} as const;

export function ProjectForm({ teamId }: { teamId: string }) {
  const [template, setTemplate] = useState<keyof typeof TEMPLATES>("course");
  const [name, setName] = useState<string>(TEMPLATES.course.name);
  const [description, setDescription] = useState<string>(TEMPLATES.course.description);
  const [state, setState] = useState<FormState>(null);
  const [pending, setPending] = useState(false);

  function applyTemplate(next: keyof typeof TEMPLATES) {
    const previous = TEMPLATES[template];
    const current = TEMPLATES[next];
    setTemplate(next);
    setName((value) => (!value || value === previous.name ? current.name : value));
    setDescription((value) =>
      !value || value === previous.description ? current.description : value,
    );
  }

  async function submit(formData: FormData) {
    setPending(true);
    setState(null);
    const result = await createProjectAction(null, formData);
    setState(result);
    setPending(false);
    if (!result) {
      setName("");
      setDescription("");
    }
  }

  return (
    <form action={submit} className="ac-card space-y-3 p-4">
      <div>
        <h2 className="font-medium text-ink">创建项目</h2>
        <p className="mt-1 text-xs text-ink-soft">先选一个项目模板，后续可以随时修改。</p>
      </div>
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="projectType" value={template} />
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">项目类型</span>
        <select
          value={template}
          onChange={(e) => applyTemplate(e.target.value as keyof typeof TEMPLATES)}
          className="ac-field"
        >
          {Object.entries(TEMPLATES).map(([value, item]) => (
            <option key={value} value={value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">项目名称</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={TEMPLATES[template].name}
          className="ac-field"
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">项目简介</span>
        <textarea
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={TEMPLATES[template].description}
          className="ac-field"
          rows={2}
        />
      </label>
      <div className="flex gap-2">
        <label className="flex-1 text-sm text-ink-soft">
          开始日期
          <input type="date" name="startDate" className="ac-field" />
        </label>
        <label className="flex-1 text-sm text-ink-soft">
          结束日期
          <input type="date" name="endDate" className="ac-field" />
        </label>
      </div>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn">
        {pending ? "创建中…" : "创建"}
      </button>
    </form>
  );
}
