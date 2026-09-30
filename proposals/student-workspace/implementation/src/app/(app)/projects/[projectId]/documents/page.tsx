import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectDocuments } from "@/lib/document";
import { DocumentWorkspace } from "./document-workspace";

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const documents = await listProjectDocuments(session.user.id, projectId);
  const canWrite = access.role === "admin" || access.role === "student";

  return (
    <main className="mx-auto max-w-6xl space-y-6 py-8">
      <header className="space-y-2">
        <Link href={`/projects/${projectId}`} className="text-xs text-ink-soft hover:text-primary">
          ← 返回项目
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">资料空间</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
              {access.project.name}
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              记录项目目标、讨论决定、阶段进展和最终成果。
            </p>
          </div>
          <span className="text-xs text-ink-faint">
            {canWrite ? "你可以编辑项目资料" : "当前为只读查看"}
          </span>
        </div>
      </header>

      <DocumentWorkspace
        projectId={projectId}
        canWrite={canWrite}
        documents={documents.map((document) => ({
          id: document.id,
          title: document.title,
          kind: document.kind,
          content: document.content,
          updatedAt: document.updatedAt.toISOString(),
        }))}
      />
    </main>
  );
}
