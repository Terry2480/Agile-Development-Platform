"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createTask, updateTask, deleteTask, setTaskSuccessors } from "@/lib/task";
import { setTaskLabels } from "@/lib/label";
import { createMilestone } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";

export type FormState = { error: string } | null;
// 更新任务专用：成功回 { ok: true }，供编辑弹窗据以自闭
export type UpdateTaskState = { error: string } | { ok: true } | null;

const createTaskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写任务标题"),
  description: z.string().trim().optional(),
  assigneeId: z.uuid().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  dueDate: z.iso.date("日期格式不正确").optional(),
  milestoneId: z.uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export async function createTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createTaskSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId || undefined,
    startDate: raw.startDate || undefined,
    dueDate: raw.dueDate || undefined,
    milestoneId: raw.milestoneId || undefined,
    priority: raw.priority || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, ...input } = parsed.data;
  try {
    await createTask(session.user.id, projectId, input);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限创建任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return null;
}

const createMilestoneSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写里程碑标题"),
  targetDate: z.iso.date("日期格式不正确").optional(),
});

export async function createMilestoneAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createMilestoneSchema.safeParse({
    ...raw,
    targetDate: raw.targetDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createMilestone(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      targetDate: parsed.data.targetDate,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可创建里程碑" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

// 拖拽可改的字段白名单。校验与授权仍全数落在 updateTask
//（指派人须属团队、里程碑须属项目），故此处只做形状校验。
const movePatchSchema = z.object({
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  milestoneId: z.uuid().nullable().optional(),
});

const moveTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  patch: movePatchSchema,
});

export async function moveTaskAction(input: {
  taskId: string;
  projectId: string;
  patch: z.infer<typeof movePatchSchema>;
}): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "参数无效" };
  // 空补丁无事可做，视为非法请求
  if (Object.keys(parsed.data.patch).length === 0) return { error: "参数无效" };

  try {
    await updateTask(session.user.id, parsed.data.taskId, parsed.data.patch);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}

const updateTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  title: z.string().trim().min(1, "标题不可为空"),
  description: z.string().trim().optional(),
  assigneeId: z.uuid().optional(),
  milestoneId: z.uuid().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  dueDate: z.iso.date("日期格式不正确").optional(),
  priority: z.enum(["low", "medium", "high"]),
  completionNote: z.string().trim().optional(),
});

export async function updateTaskAction(
  _prev: UpdateTaskState,
  formData: FormData,
): Promise<UpdateTaskState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = updateTaskSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId || undefined,
    milestoneId: raw.milestoneId || undefined,
    startDate: raw.startDate || undefined,
    dueDate: raw.dueDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { taskId, projectId, ...patch } = parsed.data;
  const successorIds = formData
    .getAll("successorIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const labelIds = formData
    .getAll("labelIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  try {
    await updateTask(session.user.id, taskId, {
      title: patch.title,
      description: patch.description ?? null,
      assigneeId: patch.assigneeId ?? null,
      milestoneId: patch.milestoneId ?? null,
      startDate: patch.startDate ?? null,
      dueDate: patch.dueDate ?? null,
      priority: patch.priority,
      completionNote: patch.completionNote ?? null,
    });
    await setTaskSuccessors(session.user.id, taskId, successorIds);
    await setTaskLabels(session.user.id, taskId, labelIds);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const deleteTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
});

export async function deleteTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteTask(session.user.id, parsed.data.taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限删除任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
