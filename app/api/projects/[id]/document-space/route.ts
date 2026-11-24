import { documentId, withDocumentUser } from "@/lib/documents/http";
import { DocumentError } from "@/lib/documents/errors";
import { documentService } from "@/lib/documents/service";
import { listNodeInput } from "@/lib/documents/validation";

// 与目录接口同一组参数；include=listing 时把首屏列表合进这次响应。
// 这样"打开空间 → 再问列表"不再是一前一后的两轮请求。
const LIST_PARAMS = ["parentId", "q", "foldersOnly", "sort", "limit", "cursor"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withDocumentUser(request, async actor => {
    const search = new URL(request.url).searchParams;
    const { space } = await documentService.openSpace(actor, "project", documentId((await params).id));
    if (search.get("include") !== "listing") return { space };

    // listNodeInput 只接受目录接口的字段，先滤掉 include 等参数再解析。
    const scoped = new URLSearchParams();
    for (const key of LIST_PARAMS) {
      const value = search.get(key);
      if (value !== null) scoped.set(key, value);
    }
    const input = listNodeInput(scoped);
    try {
      return { space, listing: await documentService.list(actor, space.id, input) };
    } catch (error) {
      // 本机保存的目录可能已被删除、移入回收站或换了空间：退回根目录，不让整个面板打不开。
      if (!(error instanceof DocumentError) || error.code !== "INVALID_TARGET") throw error;
      return { space, listing: await documentService.list(actor, space.id, { ...input, parentId: null }) };
    }
  });
}
