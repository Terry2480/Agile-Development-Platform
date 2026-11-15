import { bodyInput } from "./body";
import { z } from "zod";

export const documentName = z.string().trim().min(1, "请填写名称").max(200, "名称最多 200 个字")
  .refine(s => !/[\x00-\x1f\x7f/\\]/.test(s) && s !== "." && s !== "..", "名称不能包含斜杠、控制字符或使用点目录");
const requestId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, "操作编号不合法");
const version = z.string().regex(/^[1-9][0-9]{0,18}$/, "版本号不合法")
  .refine(s => BigInt(s) <= BigInt("9223372036854775807"), "版本号不合法");
const positiveId = z.number().int().positive().max(2147483647);
const url = z.string().trim().max(8000).url("请填写完整网址").refine(s => {
  try { return ["http:", "https:"].includes(new URL(s).protocol); } catch { return false; }
}, "仅支持 HTTP 或 HTTPS 链接");

export const createNodeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), name: documentName, parentId: positiveId.nullable(), requestId }).strict(),
  z.object({ kind: z.literal("document"), templateKey:z.enum(["blank","project-plan","meeting","weekly","retrospective","delivery","requirements","technical-design","api","test-report"]).optional(), name: documentName, parentId: positiveId, requestId }).strict(),
  z.object({ kind: z.literal("link"), name: documentName, parentId: positiveId, url, requestId }).strict(),
]);
export const renameNodeInput = z.object({ name: documentName, expectedVersion: version }).strict();
export const moveNodeInput = z.object({ targetSpaceId: positiveId, targetParentId: positiveId.nullable(), expectedVersion: version, requestId }).strict();
export type CreateNodeInput = z.infer<typeof createNodeInput>;
export type RenameNodeInput = z.infer<typeof renameNodeInput>;
export type MoveNodeInput = z.infer<typeof moveNodeInput>;
export type ListNodeInput = { parentId: number | null; q: string; foldersOnly: boolean; sort: "name" | "updated"; limit: number; cursor?: string };

export function listNodeInput(params: URLSearchParams): ListNodeInput {
  const raw = Object.fromEntries(params);
  const parsed = z.object({
    parentId: z.coerce.number().int().positive().max(2147483647).optional(),
    q: z.string().trim().max(200).default(""),
    foldersOnly: z.enum(["0", "1"]).default("0"),
    sort: z.enum(["name", "updated"]).default("updated"),
    limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(4000).optional(),
  }).strict().parse(raw);
  return { ...parsed, parentId: parsed.parentId ?? null, foldersOnly: parsed.foldersOnly === "1" };
}

export const associationInput = z.object({ action: z.enum(["add", "remove"]), nodeIds: z.array(positiveId).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "请勿重复选择资料"), expectedVersion: version, requestId }).strict();

const lockToken = z.string().regex(/^[0-9a-f]{64}$/);
export const editorInput = z.discriminatedUnion("action", [
 z.object({action:z.literal("acquire"),lockToken}).strict(),
 z.object({action:z.literal("renew"),lockToken}).strict(),
 z.object({action:z.literal("release"),lockToken}).strict(),
 z.object({action:z.literal("checkpoint"),lockToken,expectedBodyRevision:version,expectedNodeVersion:version,requestId}).strict(),
 z.object({action:z.literal("restore"),lockToken,expectedBodyRevision:version,expectedNodeVersion:version,requestId,versionId:positiveId}).strict(),
 z.object({action:z.literal("save"),lockToken,expectedBodyRevision:version,expectedNodeVersion:version,name:documentName,content:bodyInput,requestId}).strict(),
]);

export const restoreVersionInput = z.object({lockToken,expectedBodyRevision:version,expectedNodeVersion:version,requestId}).strict();

export const uploadDocumentInput=z.object({parentId:positiveId,requestId,taskId:positiveId.optional(),milestoneId:positiveId.optional()}).strict();

export const trashInput=z.object({expectedVersion:version,requestId,expectedCount:positiveId,confirmScope:z.literal(true)}).strict();
export const restoreTrashInput=z.object({expectedVersion:version,requestId}).strict();
export const purgeInput=z.object({expectedVersion:version,requestId,confirmPermanent:z.literal(true)}).strict();

export const templatePreferenceInput=z.object({templateSet:z.enum(["none","general","software"]),expectedVersion:version}).strict();

export const imageUploadInput=z.object({lockToken,requestId}).strict();
export const imageGrantInput=z.object({lockToken,sourceNodeId:positiveId.optional(),resourceId:positiveId.optional()}).strict().refine(i=>!!i.sourceNodeId!==!!i.resourceId,"请选择一种图片来源");

export const exportInput=z.object({rootId:positiveId.nullable(),format:z.enum(["pdf","markdown"]),requestId}).strict();

export const deletionInput=z.object({confirmPermanent:z.literal(true),expectedActive:z.number().int().nonnegative(),expectedTrashed:z.number().int().nonnegative()}).strict();

export const linkUpdateInput=z.object({name:documentName,url,expectedVersion:version,expectedAssociations:z.number().int().nonnegative(),confirmImpact:z.literal(true),requestId}).strict();
export const fileReplaceInput=z.object({expectedVersion:version,expectedResourceId:positiveId,expectedAssociations:z.number().int().nonnegative(),confirmImpact:z.literal(true),requestId}).strict();
