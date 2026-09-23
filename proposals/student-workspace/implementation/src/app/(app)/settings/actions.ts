"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { unbindFeishu } from "@/lib/user";

export async function unbindFeishuAction() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  await unbindFeishu(session.user.id);
  revalidatePath("/settings");
}
