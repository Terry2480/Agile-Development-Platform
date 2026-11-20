import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { docComments, docs, projects, teamMembers, users } from "@/db/schema";
import { requireUser, parseBody, parseId, handleApiError, displayName } from "@/lib/api";
import { notify, notifyMentions } from "@/lib/notify";
import { loadDocDetail } from "@/lib/docs-access";

// 文档评论：GET /api/docs/[id]/comments（时间正序）
//           POST { content, quote? }  发表评论；通知文档创建者 + @提及的项目成员
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    await loadDocDetail(user.id, docId); // 借详情校验访问权限

    const rows = await db
      .select({
        id: docComments.id,
        quote: docComments.quote,
        content: docComments.content,
        createdAt: docComments.createdAt,
        authorId: users.id,
        authorName: users.name,
        authorStudentId: users.studentId,
      })
      .from(docComments)
      .innerJoin(users, eq(users.id, docComments.authorId))
      .where(eq(docComments.docId, docId))
      .orderBy(asc(docComments.id));

    return Response.json({
      comments: rows.map((c) => ({
        id: c.id,
        quote: c.quote ?? null,
        content: c.content,
        createdAt: c.createdAt,
        author: { id: c.authorId, displayName: displayName({ name: c.authorName, studentId: c.authorStudentId }) },
        mine: c.authorId === user.id,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const commentSchema = z.object({
  content: z.string().trim().min(1, "请填写评论内容").max(2000, "评论内容过长"),
  quote: z.string().trim().max(200, "引用片段过长").optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    const { doc } = await loadDocDetail(user.id, docId);
    const body = await parseBody(request, commentSchema);

    const [created] = await db
      .insert(docComments)
      .values({ docId, authorId: user.id, quote: body.quote || null, content: body.content })
      .returning();

    // 通知文档创建者（不是自己时）+ 评论里被 @ 的项目成员
    const [project] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, doc.projectId)).limit(1);
    const members = await db
      .select({ userId: users.id, name: users.name, studentId: users.studentId })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, project.teamId));
    const actor = displayName(user);
    const [creatorRow] = await db.select({ createdById: docs.createdById }).from(docs).where(eq(docs.id, docId)).limit(1);
    if (creatorRow?.createdById) {
      await notify({
        userId: creatorRow.createdById,
        actorId: user.id,
        type: "comment",
        title: `${actor} 评论了文档《${doc.title}》`,
        entityType: "doc",
        entityId: docId,
      });
    }
    await notifyMentions({
      content: body.content,
      actorId: user.id,
      members,
      title: `${actor} 在文档《${doc.title}》中提到了你`,
      entityType: "doc",
      entityId: docId,
    });

    return Response.json({
      comment: {
        id: created.id,
        quote: created.quote ?? null,
        content: created.content,
        createdAt: created.createdAt,
        author: { id: user.id, displayName: actor },
        mine: true,
      },
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
