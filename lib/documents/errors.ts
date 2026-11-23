import { z } from "zod";
import { ApiError } from "@/lib/api";

export class DocumentError extends ApiError {
  constructor(status: number, public code: string, message: string) { super(status, message); }
}
export function documentErrorResponse(error: unknown): Response {
  if (error instanceof DocumentError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ApiError) return Response.json({ error: error.message, code: error.status === 401 ? "AUTH_REQUIRED" : "INVALID_INPUT" }, { status: error.status });
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "输入不合法", code: "INVALID_INPUT" }, { status: 400 });
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.cause?.code ?? e?.code; const message = e?.cause?.message ?? e?.message ?? "";
  const known: Record<string, [string, string]> = {
    DOCUMENT_LAST_PARTITION: ["LAST_PARTITION", "空间至少需要保留一个分区"],
    DOCUMENT_DIRECTORY_CYCLE: ["DIRECTORY_CYCLE", "不能移入自身或自己的子目录"],
    DOCUMENT_EDITING: ["DOCUMENT_EDITING", "资料正在编辑，请等待编辑结束后再操作"],
    DOCUMENT_SPACE_READ_ONLY: ["READ_ONLY_SPACE", "归档空间只能阅读，不能修改"],
    DOCUMENT_ASSOCIATION_SCOPE: ["REFERENCE_EXISTS", "跨空间移动前请先解除任务或里程碑关联"],
  };
  const match = Object.keys(known).find(k => message.includes(k));
  if (match) return Response.json({ code: known[match][0], error: known[match][1] }, { status: 409 });
  if (code === "23505") return Response.json({ code: "NAME_CONFLICT", error: "当前目录已有同名资料，请更换名称" }, { status: 409 });
  if (code === "42P01" && /relation .*document_.*does not exist/i.test(message)) return Response.json({ code: "DOCUMENTS_NOT_READY", error: "文档空间尚未启用，请联系项目维护者" }, { status: 503 });
  if (code === "23503" || code === "23514") return Response.json({ code: "INVALID_TARGET", error: "目录或资料状态已变化，请刷新后重试" }, { status: 409 });
  // Do not log SQL parameters, credentials, or document contents.
  console.error("[documents] request failed", code ?? "UNKNOWN_ERROR");
  return Response.json({ code: "SERVER_ERROR", error: "暂时无法处理文档操作，请稍后重试" }, { status: 500 });
}
