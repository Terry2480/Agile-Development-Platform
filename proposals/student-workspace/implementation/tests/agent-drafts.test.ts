import { describe, it, expect, beforeEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, project };
}

// 函数游标形式（数组形式在 5.0.218 下跳过 [0]，见 BACKLOG 依赖教训）
function replayDecompose() {
  const script = [
    {
      finishReason: "tool-calls" as const,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "c1",
          toolName: "decompose_tasks",
          input: JSON.stringify({ tasks: [{ title: "撰写问卷" }, { title: "分析数据" }] }),
        },
      ],
      warnings: [],
    },
    {
      finishReason: "stop" as const,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      content: [{ type: "text" as const, text: "已为你拟了 2 个任务，请确认。" }],
      warnings: [],
    },
  ];
  let cursor = 0;
  return new MockLanguageModelV2({ doGenerate: async () => script[cursor++] });
}

describe("runAgentTurn 提取 drafts", () => {
  beforeEach(resetDb);

  it("模型调 decompose_tasks → drafts 有任务清单、tasks 表仍空", async () => {
    const { student, project } = await scene();
    const result = await runAgentTurn({
      actorId: student.id,
      projectId: project.id,
      userText: "帮我把调研拆成任务",
      model: replayDecompose(),
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].tool).toBe("decompose_tasks");
    expect((result.drafts[0].draft as { tasks: unknown[] }).tasks).toHaveLength(2);

    const rows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    expect(rows).toHaveLength(0);
  });
});
