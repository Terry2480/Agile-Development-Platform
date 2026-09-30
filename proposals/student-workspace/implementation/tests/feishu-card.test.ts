import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAssignedCard, buildCompletedCard, buildDueReminderCard } from "@/lib/feishu-card";

beforeEach(() => vi.stubEnv("AGILECAMPUS_URL", "https://ac.test"));
afterEach(() => vi.unstubAllEnvs());

const task = {
  id: "t1", title: "斥候", projectId: "p1", projectName: "赤壁",
  assigneeName: "主帅", dueDate: "2026-08-01", priority: "high",
};

describe("buildAssignedCard", () => {
  it("含标题/项目/负责人 + 深链按钮", () => {
    const json = JSON.stringify(buildAssignedCard(task));
    expect(json).toContain("斥候");
    expect(json).toContain("赤壁");
    expect(json).toContain("主帅");
    expect(json).toContain("https://ac.test/projects/p1?task=t1");
  });
});

describe("buildCompletedCard", () => {
  it("含完成情况 + 深链", () => {
    const json = JSON.stringify(buildCompletedCard({ ...task, completionNote: "克城" }));
    expect(json).toContain("克城");
    expect(json).toContain("https://ac.test/projects/p1?task=t1");
  });
});

describe("buildDueReminderCard", () => {
  it("逾期/临期分栏 + 每任务内联深链", () => {
    const json = JSON.stringify(buildDueReminderCard({
      overdue: [{ id: "a", title: "逾期活", projectId: "p1" }],
      dueSoon: [{ id: "b", title: "临期活", projectId: "p2" }],
    }));
    expect(json).toContain("逾期活");
    expect(json).toContain("临期活");
    expect(json).toContain("https://ac.test/projects/p1?task=a");
    expect(json).toContain("https://ac.test/projects/p2?task=b");
  });
});
