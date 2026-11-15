export type DocumentKind = "folder" | "document" | "file" | "link";
export type DocumentPathItem = { id: number; name: string };
export type DocumentNode = {
  id: number; spaceId: number; parentId: number | null; kind: DocumentKind; name: string;
  fileMimeType?:string|null;
  version: string; updatedAt: string; updatedBy: { id: number | null; name: string };
  childCount: number; childFolderCount: number; associationCount: number;
  editLock: { editorId: number; editorName: string; expiresAt: string } | null;
  permissions: { read: boolean; write: boolean; rename: boolean; move: boolean };
};
export type DocumentSpace = {
  templateSet?:"none"|"general"|"software";
  id: number; teamId: number; projectId: number | null; name: string; teamName: string;
  state: "active" | "archived"; version: string; readOnly: boolean;
};
export type DocumentListing = {
  space: DocumentSpace; nodes: DocumentNode[]; path: DocumentPathItem[];
  nextCursor: string | null; total: number;
};
export type DocumentDetail = {
  trashed?:boolean;
  node: DocumentNode; space: DocumentSpace; path: DocumentPathItem[];
  operations?:{id:number;action:string;actor:string;createdAt:string}[];
  file?: {resourceId:number;uploadedBy:string;originalUploader:string;uploadedAt:string;mimeType:string;size:string;url:string;preview:boolean};
  url?: string; legacyDownloadUrl?: string; body?: unknown;
  associations: { type: "task" | "milestone"; id: number; name: string; projectId: number }[];
};
