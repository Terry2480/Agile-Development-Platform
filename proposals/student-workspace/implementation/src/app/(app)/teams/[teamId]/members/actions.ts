"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateMemberRole } from "@/lib/team";
import { AppError } from "@/lib/errors";

const schema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["admin", "teacher", "student"]),
});

export async function updateRoleAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = schema.parse(Object.fromEntries(formData));
  await updateMemberRole(session.user.id, parsed.teamId, parsed.userId, parsed.role);
  revalidatePath(`/teams/${parsed.teamId}/members`);
}
