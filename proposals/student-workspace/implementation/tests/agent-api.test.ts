import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createApiToken } from "@/lib/api-token";
import { listProjectTasks } from "@/lib/task";
import { listTeamResourceUsages } from "@/lib/resource";
import { POST as tasksRoute } from "@/app/api/agent/tasks/route";
import { POST as completeRoute } from "@/app/api/agent/tasks/complete/route";
import { POST as resourceRoute } from "@/app/api/agent/resource-usage/route";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

function req(body: unknown, token?: string) {
  return new Request("http://test/api/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  const { token } = await createApiToken(owner.id, "CC 令牌");
  return { owner, team, project, token };
}

describe("POST /api/agent/tasks", () => {
  beforeEach(resetDb);

  it("有效 token + 合法 body → 建任务", async () => {
    const { owner, project, token } = await scene();
    const res = await tasksRoute(req({ projectId: project.id, title: "斥候任务" }, token));
    expect(res.status).toBe(200);
    const tasks = await listProjectTasks(owner.id, project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("斥候任务");
  });

  it("无 token → 401", async () => {
    const { project } = await scene();
    const res = await tasksRoute(req({ projectId: project.id, title: "x" }));
    expect(res.status).toBe(401);
  });

  it("伪造 token → 401", async () => {
    const { project } = await scene();
    const res = await tasksRoute(req({ projectId: project.id, title: "x" }, "ac_forged"));
    expect(res.status).toBe(401);
  });

  it("body 缺字段 → 400", async () => {
    const { token } = await scene();
    const res = await tasksRoute(req({ title: "缺 projectId" }, token));
    expect(res.status).toBe(400);
  });

  it("越权：token 主人非目标项目成员 → 403", async () => {
    const { project } = await scene();
    const stranger = await makeUser("stranger@example.com");
    const { token: strangerToken } = await createApiToken(stranger.id, "外人令牌");
    const res = await tasksRoute(
      req({ projectId: project.id, title: "越权任务" }, strangerToken),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/agent/tasks/complete", () => {
  beforeEach(resetDb);

  it("填完成情况：status=done + completionNote", async () => {
    const { owner, project, token } = await scene();
    const created = await tasksRoute(req({ projectId: project.id, title: "待办" }, token));
    expect(created.status).toBe(200);
    const [task] = await listProjectTasks(owner.id, project.id);

    const res = await completeRoute(
      req({ taskId: task.id, completionNote: "已跑通演武" }, token),
    );
    expect(res.status).toBe(200);
    const [after] = await listProjectTasks(owner.id, project.id);
    expect(after.status).toBe("done");
    expect(after.completionNote).toBe("已跑通演武");
  });

  it("无 token → 401", async () => {
    const res = await completeRoute(req({ taskId: "x", completionNote: "y" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/agent/resource-usage", () => {
  beforeEach(resetDb);

  it("登记占用（ISO 起止字符串）", async () => {
    const { owner, team, token } = await scene();
    const res = await resourceRoute(
      req(
        {
          teamId: team.id,
          resourceName: "GPU-01",
          purpose: "训练",
          startTime: "2026-07-22T01:00:00Z",
          endTime: "2026-07-22T04:00:00Z",
        },
        token,
      ),
    );
    expect(res.status).toBe(200);
    const { usages } = await listTeamResourceUsages(owner.id, team.id);
    expect(usages).toHaveLength(1);
    expect(usages[0].resourceName).toBe("GPU-01");
    expect(usages[0].durationMinutes).toBe(180);
  });

  it("登记进行中占用（省略 endTime）", async () => {
    const { owner, team, token } = await scene();
    const res = await resourceRoute(
      req(
        { teamId: team.id, resourceName: "GPU-02", startTime: "2026-07-22T01:00:00Z" },
        token,
      ),
    );
    expect(res.status).toBe(200);
    const { usages } = await listTeamResourceUsages(owner.id, team.id);
    expect(usages[0].active).toBe(true);
  });

  it("越权：非该团队成员 → 403", async () => {
    const { team } = await scene();
    const stranger = await makeUser("stranger@example.com");
    const { token: strangerToken } = await createApiToken(stranger.id, "外人令牌");
    const res = await resourceRoute(
      req(
        { teamId: team.id, resourceName: "GPU-01", startTime: "2026-07-22T01:00:00Z" },
        strangerToken,
      ),
    );
    expect(res.status).toBe(403);
  });
});
