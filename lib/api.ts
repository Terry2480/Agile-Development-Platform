import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teams, teamMembers, projects } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

/* 业务 API 通用工具：鉴权、参数解析、权限校验、错误统一处理 */

// 业务错误：带 HTTP 状态码，路由里 throw 后由 handleApiError 统一转成响应
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// 所有业务路由的统一错误出口：业务错误按状态码返回；未知错误打日志返回 500
export function handleApiError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const anyError = error as { cause?: { code?: string }; code?: string };
  if (anyError?.cause?.code === "23505" || anyError?.code === "23505") {
    return Response.json({ error: "数据冲突，请刷新后重试" }, { status: 409 });
  }
  console.error("[api]", error);
  return Response.json({ error: "服务器异常，请稍后重试" }, { status: 500 });
}

// 要求已登录：未登录抛 401，否则返回当前用户（不含密码哈希）
export async function requireUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw new ApiError(401, "未登录");
  return user;
}

// 解析请求体并按 zod schema 校验：失败抛 400（取第一条中文提示）
export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  const json = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "参数错误");
  }
  return parsed.data;
}

// 校验路由参数里的正整数 id
export function parseId(value: string | undefined, label = "ID"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${label}不合法`);
  return id;
}

// 展示名：名称未填时回落学工号（与前端一致）
export function displayName(user: { name: string | null; studentId: string }): string {
  return user.name || user.studentId;
}

// 任务编号：项目 key + 三位序号，如 WEB-024
export function taskCode(key: string, number: number): string {
  return `${key}-${String(number).padStart(3, "0")}`;
}

// 状态 / 优先级的中文映射（活动记录、通知文案用）
export const STATUS_LABEL: Record<string, string> = { todo: "待开始", doing: "进行中", done: "已完成" };
export const PRIORITY_LABEL: Record<string, string> = { low: "低", medium: "中", high: "高" };

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };

// 团队访问校验：必须是团队成员；minRole 提权到 admin / owner
// 返回 { team, membership }（membership.role 为我在该团队的角色）
export async function requireTeamAccess(userId: number, teamId: number, minRole: "member" | "admin" | "owner" = "member", executor: Pick<typeof db, "select"> = db) {
  const rows = await executor
    .select({ team: teams, membership: teamMembers })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ApiError(403, "你不是该团队成员");
  if (ROLE_RANK[row.membership.role] < ROLE_RANK[minRole]) {
    throw new ApiError(403, "没有权限执行此操作");
  }
  return row;
}

// 项目访问校验：项目必须存在，且当前用户是其所属团队的成员
// 返回 { project, team, membership }
export async function requireProjectAccess(userId: number, projectId: number, minRole: "member" | "admin" | "owner" = "member", executor: Pick<typeof db, "select"> = db) {
  const rows = await executor
    .select({ project: projects, team: teams, membership: teamMembers })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)))
    .where(eq(projects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ApiError(404, "项目不存在");
  if (ROLE_RANK[row.membership.role] < ROLE_RANK[minRole]) {
    throw new ApiError(403, "没有权限执行此操作");
  }
  return row;
}
