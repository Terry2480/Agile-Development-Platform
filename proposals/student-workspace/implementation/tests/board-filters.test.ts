import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  parseFilters,
  serializeFilters,
  applyFilters,
  type FilterableTask,
} from "@/lib/board-filters";
import { deriveColumns } from "@/lib/board-columns";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const M = "33333333-3333-3333-3333-333333333333";
const L = "44444444-4444-4444-4444-444444444444";

function task(over: Partial<FilterableTask> = {}): FilterableTask {
  return {
    assigneeId: null,
    priority: "medium",
    milestoneId: null,
    dueDate: null,
    status: "todo",
    labels: [],
    ...over,
  };
}

describe("parseFilters", () => {
  it("空参数返回空筛选，默认按状态分组", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(EMPTY_FILTERS);
  });

  it("解析多值与开关", () => {
    const f = parseFilters(
      new URLSearchParams(`assignee=${A},${B}&priority=high&overdue=1&group=assignee`),
    );
    expect(f.assignee).toEqual([A, B]);
    expect(f.priority).toEqual(["high"]);
    expect(f.overdue).toBe(true);
    expect(f.group).toBe("assignee");
  });

  it("非法值被忽略而非抛错", () => {
    const f = parseFilters(new URLSearchParams("assignee=不是uuid&priority=urgent&group=galaxy"));
    expect(f.assignee).toEqual([]);
    expect(f.priority).toEqual([]);
    expect(f.group).toBe("status");
  });

  it("assignee 与 milestone 接受 none 表示未指派/无里程碑", () => {
    const f = parseFilters(new URLSearchParams("assignee=none&milestone=none"));
    expect(f.assignee).toEqual(["none"]);
    expect(f.milestone).toEqual(["none"]);
  });

  it("无关参数（如深链 task）不影响解析", () => {
    const f = parseFilters(new URLSearchParams(`task=${A}`));
    expect(f).toEqual(EMPTY_FILTERS);
  });
});

describe("serializeFilters", () => {
  it("空筛选序列化为空串", () => {
    expect(serializeFilters(EMPTY_FILTERS)).toBe("");
  });

  it("与 parseFilters 往返一致", () => {
    const f = {
      ...EMPTY_FILTERS,
      assignee: [A, B],
      label: [L],
      overdue: true,
      group: "milestone" as const,
    };
    expect(parseFilters(new URLSearchParams(serializeFilters(f)))).toEqual(f);
  });

  it("默认分组不写入 query", () => {
    expect(serializeFilters({ ...EMPTY_FILTERS, group: "status" })).toBe("");
  });
});

describe("applyFilters", () => {
  const today = "2026-08-20";

  it("无筛选则原样返回", () => {
    const list = [task(), task({ priority: "high" })];
    expect(applyFilters(list, EMPTY_FILTERS, today)).toHaveLength(2);
  });

  it("按指派人筛选，none 命中未指派", () => {
    const list = [task({ assigneeId: A }), task({ assigneeId: null })];
    expect(applyFilters(list, { ...EMPTY_FILTERS, assignee: [A] }, today)).toHaveLength(1);
    expect(applyFilters(list, { ...EMPTY_FILTERS, assignee: ["none"] }, today)).toHaveLength(1);
  });

  it("按标签筛选：任务命中任一所选标签即算", () => {
    const list = [task({ labels: [{ id: L }] }), task()];
    expect(applyFilters(list, { ...EMPTY_FILTERS, label: [L] }, today)).toHaveLength(1);
  });

  it("按里程碑筛选，none 命中无里程碑", () => {
    const list = [task({ milestoneId: M }), task()];
    expect(applyFilters(list, { ...EMPTY_FILTERS, milestone: ["none"] }, today)).toHaveLength(1);
  });

  it("逾期开关：截止日早于今日且未完成方算逾期", () => {
    const list = [
      task({ dueDate: "2026-08-19" }),
      task({ dueDate: "2026-08-19", status: "done" }),
      task({ dueDate: "2026-08-21" }),
      task({ dueDate: null }),
    ];
    expect(applyFilters(list, { ...EMPTY_FILTERS, overdue: true }, today)).toHaveLength(1);
  });

  it("多维筛选取交集", () => {
    const list = [
      task({ assigneeId: A, priority: "high" }),
      task({ assigneeId: A, priority: "low" }),
      task({ assigneeId: B, priority: "high" }),
    ];
    const f = { ...EMPTY_FILTERS, assignee: [A], priority: ["high"] };
    expect(applyFilters(list, f, today)).toHaveLength(1);
  });
});

describe("deriveColumns", () => {
  const ctx = {
    members: [
      { id: A, name: "周瑜" },
      { id: B, name: "鲁肃" },
    ],
    milestones: [{ id: M, name: "一期" }],
  };

  it("按状态分组：三列，patch 改 status", () => {
    const cols = deriveColumns("status", ctx);
    expect(cols.map((c) => c.key)).toEqual(["todo", "doing", "done"]);
    expect(cols[1].patch).toEqual({ status: "doing" });
    expect(cols[1].matches(task({ status: "doing" }))).toBe(true);
    expect(cols[1].matches(task({ status: "todo" }))).toBe(false);
  });

  it("按指派人分组：每成员一列 + 未指派列，patch 改 assigneeId", () => {
    const cols = deriveColumns("assignee", ctx);
    expect(cols.map((c) => c.key)).toEqual([A, B, "none"]);
    expect(cols[0].patch).toEqual({ assigneeId: A });
    expect(cols[2].patch).toEqual({ assigneeId: null });
    expect(cols[2].matches(task({ assigneeId: null }))).toBe(true);
  });

  it("按优先级分组：高中低三列，patch 改 priority", () => {
    const cols = deriveColumns("priority", ctx);
    expect(cols.map((c) => c.key)).toEqual(["high", "medium", "low"]);
    expect(cols[0].patch).toEqual({ priority: "high" });
  });

  it("按里程碑分组：每里程碑一列 + 无里程碑列", () => {
    const cols = deriveColumns("milestone", ctx);
    expect(cols.map((c) => c.key)).toEqual([M, "none"]);
    expect(cols[1].patch).toEqual({ milestoneId: null });
    expect(cols[0].matches(task({ milestoneId: M }))).toBe(true);
  });

  it("成员为空时按指派人分组仍有未指派列", () => {
    const cols = deriveColumns("assignee", { members: [], milestones: [] });
    expect(cols.map((c) => c.key)).toEqual(["none"]);
  });
});
