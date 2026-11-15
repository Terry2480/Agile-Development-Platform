import { z } from "zod";
import { requireUser } from "@/lib/api";
import { documentErrorResponse } from "./errors";

export const documentId = (value: string) => z.string().regex(/^[1-9][0-9]*$/, "编号不合法").transform(Number).pipe(z.number().int().max(2147483647)).parse(value);
export async function withDocumentUser(request: Request, operation: (userId: number) => Promise<unknown>, status = 200) {
  try {
    const user = await requireUser(request);
    return Response.json(await operation(user.id), { status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return documentErrorResponse(error); }
}
