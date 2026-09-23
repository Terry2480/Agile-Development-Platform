import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, listSubtasks, listProjectTasks } from "@/lib/task";
import { createApiToken } from "@/lib/api-token";
import {
  GET as listSubtasksRoute,
  POST as newSubtask,
} from "@/app/api/agent/tasks/[taskId]/subtasks/route";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

function get(url: string, token?: string) {
  return new Request(`http://test${url}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function post(body: unknown, token?: string) {
  return new Request("http://test/api/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ctx = (taskId: string) => ({ params: Promise.resolve({ taskId }) });

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  const parent = await createTask(owner.id, project.id, { title: "攻取AI功能" });
  const { token } = await createApiToken(owner.id, "CC 令牌");
  return { owner, student, team, project, parent, token };
}

describe("POST /api/agent/tasks/:taskId/subtasks", () => {
  beforeEach(resetDb);

  it("在任务下建子任务，projectId 由父任务推得", async () => {
    const { owner, project, parent, token } = await scene();
    const res = await newSubtask(post({ title: "子：设计接口" }, token), ctx(parent.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("子：设计接口");
    expect(body.parentTaskId).toBe(parent.id);
    expect(body.projectId).toBe(project.id);

    const subs = await listSubtasks(owner.id, parent.id);
    expect(subs).toHaveLength(1);
  });

  it("子任务可带负责人、截止日与优先级", async () => {
    const { owner, student, parent, token } = await scene();
    const res = await newSubtask(
      post(
        { title: "子：写测试", assigneeId: student.id, dueDate: "2026-09-01", priority: "high" },
        token,
      ),
      ctx(parent.id),
    );
    expect(res.status).toBe(200);

    const [sub] = await listSubtasks(owner.id, parent.id);
    expect(sub.assigneeName).toBe("student");
    expect(sub.dueDate).toBe("2026-09-01");
    expect(sub.priority).toBe("high");
  });

  it("父任务不存在 → 400", async () => {
    const { token } = await scene();
    const ghost = "00000000-0000-4000-8000-000000000000";
    const res = await newSubtask(post({ title: "孤儿" }, token), ctx(ghost));
    expect(res.status).toBe(400);
  });

  it("非成员 → 403", async () => {
    const { parent } = await scene();
    const s = await makeUser("stranger@example.com");
    const { token } = await createApiToken(s.id, "外人令牌");
    const res = await newSubtask(post({ title: "越权子任务" }, token), ctx(parent.id));
    expect(res.status).toBe(403);
  });

  it("缺 title → 400；无 token → 401；taskId 非 uuid → 400", async () => {
    const { parent, token } = await scene();
    expect((await newSubtask(post({}, token), ctx(parent.id))).status).toBe(400);
    expect((await newSubtask(post({ title: "x" }), ctx(parent.id))).status).toBe(401);
    expect((await newSubtask(post({ title: "x" }, token), ctx("not-a-uuid"))).status).toBe(400);
  });
});

describe("GET /api/agent/tasks/:taskId/subtasks", () => {
  beforeEach(resetDb);

  it("列出直接子级，不含孙级", async () => {
    const { owner, project, parent, token } = await scene();
    const child = await createTask(owner.id, project.id, {
      title: "子甲",
      parentTaskId: parent.id,
    });
    await createTask(owner.id, project.id, { title: "子乙", parentTaskId: parent.id });
    await createTask(owner.id, project.id, { title: "孙丙", parentTaskId: child.id });

    const res = await listSubtasksRoute(
      get(`/api/agent/tasks/${parent.id}/subtasks`, token),
      ctx(parent.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parentTaskId).toBe(parent.id);
    expect(body.subtasks).toHaveLength(2);
    expect(body.subtasks.map((s: { title: string }) => s.title).sort()).toEqual(["子乙", "子甲"]);
  });

  it("无子任务 → 空数组", async () => {
    const { parent, token } = await scene();
    const res = await listSubtasksRoute(
      get(`/api/agent/tasks/${parent.id}/subtasks`, token),
      ctx(parent.id),
    );
    expect((await res.json()).subtasks).toHaveLength(0);
  });

  it("非成员 → 403；无 token → 401", async () => {
    const { parent } = await scene();
    const s = await makeUser("stranger@example.com");
    const { token } = await createApiToken(s.id, "外人令牌");
    expect(
      (await listSubtasksRoute(get(`/api/agent/tasks/${parent.id}/subtasks`, token), ctx(parent.id)))
        .status,
    ).toBe(403);
    expect(
      (await listSubtasksRoute(get(`/api/agent/tasks/${parent.id}/subtasks`), ctx(parent.id)))
        .status,
    ).toBe(401);
  });
});

describe("子任务归属与级联", () => {
  beforeEach(resetDb);

  it("跨项目挂载被拒", async () => {
    const { owner, team, parent } = await scene();
    const other = await createProject(owner.id, team.id, { name: "夷陵之役" });
    await expect(
      createTask(owner.id, other.id, { title: "跨项目子任务", parentTaskId: parent.id }),
    ).rejects.toThrow("父任务不属于该项目");
  });

  it("顶层任务 parentTaskId 为 null", async () => {
    const { owner, project, parent } = await scene();
    const rows = await listProjectTasks(owner.id, project.id);
    expect(rows.find((r) => r.id === parent.id)!.parentTaskId).toBeNull();
  });
});
