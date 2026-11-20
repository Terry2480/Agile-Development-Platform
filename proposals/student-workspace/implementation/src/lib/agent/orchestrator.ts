import { generateText, stepCountIs, type LanguageModel } from "ai";
import { buildTools, type DraftEnvelope } from "./tools";
import { buildProjectSnapshot } from "./snapshot";
import {
  getOrCreateConversation,
  persistTurn,
  type ToolTraceEntry,
} from "./conversation";
import { getModel } from "./model";

const SYSTEM_PREAMBLE = `你是 AgileCampus（敏捷校园）的项目管理助手，服务高校科研与课程团队。
你的职责限于项目管理：拆解目标、排期、指派、跟踪进度、答疑项目现状。你不代做研究、编码或写作等实际工作。

## 写操作一律走草案
建项目、建里程碑、拆任务、改任务、排期——这些工具都只产出**草案卡片**，由用户在界面上点「确认落库」后才真正生效。
因此产出草案后，据实说「已拟好草案，请确认」，**绝不可声称已创建、已保存、已完成**。

**只有真正调用工具才会生成草案卡片。你在正文里敲的文字不会变成草案。**
所以：凡要改动任何东西，必须实际调用对应工具；绝不可只用文字描述你「将要拟」或「已拟好」的内容——
那样用户界面上什么都不会出现，等于骗了他。先调工具，再说话。

## 工具选用
- 问进度、要统计 → query_progress
- 要任务清单，或改任务前需先取 taskId → list_tasks
- 问「我有哪些项目」、需跨项目比较 → list_projects
- 需要 milestoneId 而快照未列出 → list_milestones
- 用户要新建或拆解任务 → decompose_tasks（**哪怕只建一个任务也用它**）
- 改任务的状态/负责人/截止日/优先级 → 先 list_tasks 取 id 与现状，再 update_tasks
- 把若干任务归入某里程碑并统一截止日 → plan_sprint
- 新建项目 → create_project；新建里程碑（阶段节点）→ create_milestone

## 军规
1. **一切 id 只能取自快照或工具返回**，禁止臆造，禁止拿人名或标题当 id。取不到就先调读工具。
2. 日期一律 YYYY-MM-DD。相对日期（「下周五」「月底」）以快照给出的「今天」为基准推算。
3. assigneeId 只能用快照「成员」段落里的 id。用户报人名时自行对应；对不上或有歧义就问，别猜。
4. 拆任务须可执行、粒度适中：一条一个动作，通常 3–8 条。既不可拆成空泛口号，也不必拆到几十条。
5. 用中文作答，简明扼要。草案已在界面上逐条展示，正文里不必再复述一遍。
6. **只要能从用户话里提炼出一个动宾短语当标题，就立刻拟草案，不许追问。**
   例：用户说「帮我新建一个完成ai的任务」——哪怕说法笼统，也直接调 decompose_tasks 拟出
   「完成 AI 功能」这条任务，负责人、截止日、里程碑一概留空。用户嫌不准，在卡片上改一下即可。
   卡片可改字段 + 确认落库一关已是双重兜底，先拟后改远胜于盘问。
   唯有连「做什么」都完全无从判断时（如只说「帮我建个任务」而无任何内容）才发问，且一次问完。`;

export async function runAgentTurn(params: {
  actorId: string;
  projectId: string;
  userText: string;
  model?: LanguageModel;
}) {
  const { actorId, projectId, userText, model } = params;

  // 权限收敛：会话创建内部经 getProjectForUser 校验，非成员/不存在一律 ForbiddenError
  const conversation = await getOrCreateConversation(actorId, projectId);
  const snapshot = await buildProjectSnapshot(actorId, projectId);
  const tools = buildTools(actorId, projectId);

  const result = await generateText({
    model: model ?? getModel(),
    system: `${SYSTEM_PREAMBLE}\n\n${snapshot}`,
    tools,
    stopWhen: stepCountIs(5),
    // 设计 §6.4：不自动重试——覆盖 AI SDK 默认 maxRetries=2，失败即如实呈报
    maxRetries: 0,
    messages: [{ role: "user", content: userText }],
  });

  // 工具轨迹：逐步展开 toolCalls 与对应 toolResults
  const toolTrace: ToolTraceEntry[] = result.steps.flatMap((step) =>
    step.toolCalls.map((tc, i) => ({
      toolName: tc.toolName,
      input: tc.input,
      output: step.toolResults[i]?.output,
    })),
  );

  // 写工具草案：从各步 toolResults 中提取带 __draft 标记的信封
  const drafts: DraftEnvelope[] = result.steps.flatMap((step) =>
    step.toolResults
      .map((tr) => tr.output as unknown)
      .filter(
        (o): o is DraftEnvelope =>
          typeof o === "object" && o !== null && (o as { __draft?: unknown }).__draft === true,
      ),
  );

  await persistTurn(conversation.id, userText, result.text, toolTrace);

  return { conversationId: conversation.id, text: result.text, toolTrace, drafts };
}
