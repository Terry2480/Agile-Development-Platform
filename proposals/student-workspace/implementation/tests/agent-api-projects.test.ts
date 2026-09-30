import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { createApiToken } from "@/lib/api-token";
import { GET as listProjects, POST as newProject } from "@/app/api/agent/projects/route";
import {
  GET as projectDetail,
  PATCH as patchProject,
} from "@/app/api/agent/projects/[projectId]/route";
import {
  GET as listTasks,
  POST as newTask,
} from "@/app/api/agent/projects/[projectId]/tasks/route";
import { GET as taskDetail } from "@/app/api/agent/tasks/[taskId]/route";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

function get(url: string, token?: string) {
  return new Request(`http://test${url}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function send(method: string, body: unknown, token?: string) {
  return new Request("http://test/api/agent", {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  const { token } = await createApiToken(owner.id, "CC 令牌");
  const { token: studentToken } = await createApiToken(student.id, "学生令牌");
  return { owner, student, team, project, token, studentToken };
}

async function stranger() {
  const s = await makeUser("stranger@example.com");
  const { token } = await createApiToken(s.id, "外人令牌");
  return { user: s, token };
}

describe("GET /api/agent/projects", () => {
  beforeEach(resetDb);

  it("列出我参与的项目及任务统计", async () => {
    const { owner, project, token } = await scene();
    await createTask(owner.id, project.id, { title: "甲" });

    const res = await listProjects(get("/api/agent/projects", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("赤壁演习");
    expect(body.projects[0].taskTotal).toBe(1);
    expect(body.projects[0].doneCount).toBe(0);
  });

  it("无 token → 401", async () => {
    await scene();
    const res = await listProjects(get("/api/agent/projects"));
    expect(res.status).toBe(401);
  });

  it("外人只见自己的（空）项目，不泄露他人", async () => {
    await scene();
    const { token } = await stranger();
    const res = await listProjects(get("/api/agent/projects", token));
    expect(res.status).toBe(200);
    expect((await res.json()).projects).toHaveLength(0);
  });
});

describe("POST /api/agent/projects", () => {
  beforeEach(resetDb);

  it("admin 建项目", async () => {
    const { team, token } = await scene();
    const res = await newProject(
      send("POST", { teamId: team.id, name: "夷陵之役", description: "新战役" }, token),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("夷陵之役");
  });

  it("非 admin（student）建项目 → 403", async () => {
    const { team, studentToken } = await scene();
    const res = await newProject(send("POST", { teamId: team.id, name: "越权项目" }, studentToken));
    expect(res.status).toBe(403);
  });

  it("缺 name → 400", async () => {
    const { team, token } = await scene();
    const res = await newProject(send("POST", { teamId: team.id }, token));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agent/projects/:projectId", () => {
  beforeEach(resetDb);

  it("返回项目详情与任务状态计数", async () => {
    const { owner, project, token } = await scene();
    await createTask(owner.id, project.id, { title: "甲" });

    const res = await projectDetail(
      get(`/api/agent/projects/${project.id}`, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("赤壁演习");
    expect(body.myRole).toBe("admin");
    expect(body.taskTotal).toBe(1);
    expect(body.byStatus).toEqual({ todo: 1, doing: 0, done: 0 });
  });

  it("非成员 → 403", async () => {
    const { project } = await scene();
    const { token } = await stranger();
    const res = await projectDetail(
      get(`/api/agent/projects/${project.id}`, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(403);
  });

  it("projectId 非 uuid → 400", async () => {
    const { token } = await scene();
    const res = await projectDetail(
      get("/api/agent/projects/not-a-uuid", token),
      ctx({ projectId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/agent/projects/:projectId", () => {
  beforeEach(resetDb);

  it("admin 改名并归档", async () => {
    const { project, token } = await scene();
    const res = await patchProject(
      send("PATCH", { name: "赤壁（已结）", status: "archived" }, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("赤壁（已结）");
    expect(body.status).toBe("archived");
  });

  it("非 admin（student）改项目 → 403", async () => {
    const { project, studentToken } = await scene();
    const res = await patchProject(
      send("PATCH", { name: "越权改名" }, studentToken),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(403);
  });

  it("空 patch → 400", async () => {
    const { project, token } = await scene();
    const res = await patchProject(send("PATCH", {}, token), ctx({ projectId: project.id }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agent/projects/:projectId/tasks", () => {
  beforeEach(resetDb);

  it("列出该项目任务", async () => {
    const { owner, student, project, token } = await scene();
    await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await createTask(owner.id, project.id, { title: "乙" });

    const res = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks`, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).tasks).toHaveLength(2);
  });

  it("按 status 与 assigneeId 筛选", async () => {
    const { owner, student, project, token } = await scene();
    await createTask(owner.id, project.id, { title: "甲", assigneeId: student.id });
    await createTask(owner.id, project.id, { title: "乙" });

    const byAssignee = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks?assigneeId=${student.id}`, token),
      ctx({ projectId: project.id }),
    );
    const list = (await byAssignee.json()).tasks;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("甲");
    expect(list[0].assigneeName).toBe("student");

    const done = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks?status=done`, token),
      ctx({ projectId: project.id }),
    );
    expect((await done.json()).tasks).toHaveLength(0);
  });

  it("按 dueBefore 筛选（含当日）", async () => {
    const { owner, project, token } = await scene();
    await createTask(owner.id, project.id, { title: "早", dueDate: "2026-09-01" });
    await createTask(owner.id, project.id, { title: "晚", dueDate: "2026-12-01" });

    const res = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks?dueBefore=2026-09-30`, token),
      ctx({ projectId: project.id }),
    );
    const list = (await res.json()).tasks;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("早");
  });

  it("非成员 → 403", async () => {
    const { project } = await scene();
    const { token } = await stranger();
    const res = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks`, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(403);
  });

  it("无 token → 401", async () => {
    const { project } = await scene();
    const res = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks`),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/agent/projects/:projectId/tasks", () => {
  beforeEach(resetDb);

  it("在该项目下建任务（projectId 取自路径）", async () => {
    const { project, token } = await scene();
    const res = await newTask(
      send("POST", { title: "斥候任务", priority: "high" }, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("斥候任务");

    const listed = await listTasks(
      get(`/api/agent/projects/${project.id}/tasks`, token),
      ctx({ projectId: project.id }),
    );
    expect((await listed.json()).tasks).toHaveLength(1);
  });

  it("非成员 → 403", async () => {
    const { project } = await scene();
    const { token } = await stranger();
    const res = await newTask(
      send("POST", { title: "越权任务" }, token),
      ctx({ projectId: project.id }),
    );
    expect(res.status).toBe(403);
  });

  it("缺 title → 400", async () => {
    const { project, token } = await scene();
    const res = await newTask(send("POST", {}, token), ctx({ projectId: project.id }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agent/tasks/:taskId", () => {
  beforeEach(resetDb);

  it("返回单任务详情（含负责人名）", async () => {
    const { owner, student, project, token } = await scene();
    const t = await createTask(owner.id, project.id, {
      title: "调研现有方案",
      assigneeId: student.id,
      dueDate: "2026-09-01",
    });

    const res = await taskDetail(get(`/api/agent/tasks/${t.id}`, token), ctx({ taskId: t.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("调研现有方案");
    expect(body.assigneeName).toBe("student");
    expect(body.dueDate).toBe("2026-09-01");
    expect(body.projectId).toBe(project.id);
  });

  it("非成员 → 403", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    const { token } = await stranger();
    const res = await taskDetail(get(`/api/agent/tasks/${t.id}`, token), ctx({ taskId: t.id }));
    expect(res.status).toBe(403);
  });

  it("taskId 非 uuid → 400", async () => {
    const { token } = await scene();
    const res = await taskDetail(
      get("/api/agent/tasks/not-a-uuid", token),
      ctx({ taskId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
  });
});
