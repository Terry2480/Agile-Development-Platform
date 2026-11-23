import { describe, it, expect, beforeEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listConversationMessages } from "@/lib/agent/conversation";
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
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

// 录制脚本：第一轮请求调 query_progress 工具，第二轮据结果出文本。
// 注：ai@5.0.218 的 MockLanguageModelV2 数组回放为 1 基（doGenerate[calls.length]，push 后取值会跳过 [0]），
// 故改用函数式回放 + 自增游标，逐轮返回脚本，确保工具循环真正被驱动。
function replayModel() {
  const script: Awaited<ReturnType<MockLanguageModelV2["doGenerate"]>>[] = [
    {
      finishReason: "tool-calls",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: [
        { type: "tool-call", toolCallId: "call-1", toolName: "query_progress", input: "{}" },
      ],
      warnings: [],
    },
    {
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      content: [{ type: "text", text: "该项目当前共有 1 个任务，均待办。" }],
      warnings: [],
    },
  ];
  let cursor = 0;
  return new MockLanguageModelV2({ doGenerate: async () => script[cursor++] });
}

describe("runAgentTurn（replay）", () => {
  beforeEach(resetDb);

  it("模型调 query_progress → 落库 → 出文本", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "甲" });

    const result = await runAgentTurn({
      actorId: student.id,
      projectId: project.id,
      userText: "项目进度如何？",
      model: replayModel(),
    });

    expect(result.text).toContain("1 个任务");

    const msgs = await listConversationMessages(student.id, result.conversationId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    const trace = msgs[1].toolCalls as { toolName: string }[];
    expect(trace.some((e) => e.toolName === "query_progress")).toBe(true);
  });

  it("非成员被拒（编排入口经会话创建收敛权限）", async () => {
    const { outsider, project } = await scene();
    await expect(
      runAgentTurn({
        actorId: outsider.id,
        projectId: project.id,
        userText: "偷看进度",
        model: replayModel(),
      }),
    ).rejects.toThrow("没有权限");
  });

  it("越权项目 id 亦被拒", async () => {
    const { student } = await scene();
    await expect(
      runAgentTurn({
        actorId: student.id,
        projectId: "00000000-0000-0000-0000-000000000000",
        userText: "偷看",
        model: replayModel(),
      }),
    ).rejects.toThrow("没有权限");
  });
});
