import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, getTeamMembership, joinTeam, listTeamMembers, requireTeamRole, updateMemberRole } from "@/lib/team";
import { AppError } from "@/lib/errors";
import { resetDb } from "./helpers";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

describe("createTeam", () => {
  beforeEach(resetDb);

  it("创建团队，创建者成为 admin，且生成邀请码", async () => {
    const u = await makeUser("owner@example.com");
    const team = await createTeam(u.id, "东吴实验室");
    expect(team.name).toBe("东吴实验室");
    expect(team.inviteCode).toHaveLength(10);

    const [m] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, u.id)));
    expect(m.role).toBe("admin");
  });
});

describe("joinTeam", () => {
  beforeEach(resetDb);

  it("凭邀请码加入，默认角色 student", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const joiner = await makeUser("joiner@example.com");

    const joined = await joinTeam(joiner.id, team.inviteCode);
    expect(joined.teamId).toBe(team.id);

    const [m] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, joiner.id)));
    expect(m.role).toBe("student");
  });

  it("邀请码无效时抛出可展示错误", async () => {
    const u = await makeUser("a@example.com");
    await expect(joinTeam(u.id, "no-such-code")).rejects.toThrow("邀请码无效");
  });

  it("重复加入抛出可展示错误", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    await expect(joinTeam(owner.id, team.inviteCode)).rejects.toThrow("已在该团队中");
  });

  it("绕过查重的唯一键冲突（23505）被转译为可展示的 AppError", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const joiner = await makeUser("joiner@example.com");

    let releaseTx!: () => void;
    const hold = new Promise<void>((r) => (releaseTx = r));
    let markInserted!: () => void;
    const inserted = new Promise<void>((r) => (markInserted = r));

    // 事务先插入同一 (team_id, user_id) 但不提交：joinTeam 的查重（读已提交）看不到该行，
    // 其 insert 将阻塞在唯一索引锁上；事务提交后必现 23505，
    // 从而确定性地覆盖「查重通过但唯一约束拦截」的竞态路径。
    const tx = db.transaction(async (trx) => {
      await trx.insert(teamMembers).values({ teamId: team.id, userId: joiner.id, role: "student" });
      markInserted();
      await hold;
    });

    await inserted;
    const pending = joinTeam(joiner.id, team.inviteCode);
    pending.catch(() => {}); // 预挂 handler，消除拒绝早于断言挂接的瞬时 unhandled rejection
    await new Promise((r) => setTimeout(r, 300)); // 让 joinTeam 完成查重并阻塞于 insert
    releaseTx();
    await tx;

    await expect(pending).rejects.toBeInstanceOf(AppError);
    await expect(pending).rejects.toThrow("已在该团队中");
  });
});

describe("getTeamMembership", () => {
  beforeEach(resetDb);

  it("成员返回记录（含 role）", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const m = await getTeamMembership(owner.id, team.id);
    expect(m).not.toBeNull();
    expect(m!.role).toBe("admin");
  });

  it("非成员返回 null", async () => {
    const owner = await makeUser("owner@example.com");
    const outsider = await makeUser("outsider@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const m = await getTeamMembership(outsider.id, team.id);
    expect(m).toBeNull();
  });
});

describe("requireTeamRole", () => {
  beforeEach(resetDb);

  it("角色在允许列表内则返回成员记录", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const m = await requireTeamRole(owner.id, team.id, ["admin"]);
    expect(m.role).toBe("admin");
  });

  it("非成员抛 ForbiddenError", async () => {
    const owner = await makeUser("owner@example.com");
    const outsider = await makeUser("outsider@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    await expect(requireTeamRole(outsider.id, team.id, ["admin", "teacher", "student"]))
      .rejects.toThrow("没有权限");
  });

  it("角色不足抛 ForbiddenError", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const student = await makeUser("student@example.com");
    await joinTeam(student.id, team.inviteCode);
    await expect(requireTeamRole(student.id, team.id, ["admin"]))
      .rejects.toThrow("没有权限");
  });

  it("teacher 矩阵：允许列表含 teacher 则通过，仅 admin 则拒", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const teacher = await makeUser("teacher@example.com");
    await joinTeam(teacher.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, teacher.id, "teacher");

    const m = await requireTeamRole(teacher.id, team.id, ["admin", "teacher"]);
    expect(m.role).toBe("teacher");
    await expect(requireTeamRole(teacher.id, team.id, ["admin"]))
      .rejects.toThrow("没有权限");
  });
});

describe("listTeamMembers", () => {
  beforeEach(resetDb);

  it("返回团队全员（含 role）", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const teacher = await makeUser("teacher@example.com");
    await joinTeam(teacher.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, teacher.id, "teacher");

    const list = await listTeamMembers(team.id);
    expect(list).toHaveLength(2);
    expect(list.find((m) => m.id === owner.id)?.role).toBe("admin");
    const t = list.find((m) => m.id === teacher.id);
    expect(t?.role).toBe("teacher");
    expect(t?.name).toBe("teacher");
  });

  it("不含他团队成员", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const other = await makeUser("other@example.com");
    await createTeam(other.id, "曹魏参谋部");

    const list = await listTeamMembers(team.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(owner.id);
  });
});

describe("updateMemberRole", () => {
  beforeEach(resetDb);

  it("admin 可将成员改为 teacher", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const member = await makeUser("t@example.com");
    await joinTeam(member.id, team.inviteCode);

    const updated = await updateMemberRole(owner.id, team.id, member.id, "teacher");
    expect(updated.role).toBe("teacher");
  });

  it("student 无权改角色", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const s1 = await makeUser("s1@example.com");
    const s2 = await makeUser("s2@example.com");
    await joinTeam(s1.id, team.inviteCode);
    await joinTeam(s2.id, team.inviteCode);

    await expect(updateMemberRole(s1.id, team.id, s2.id, "teacher"))
      .rejects.toThrow("没有权限");
  });

  it("目标用户不在团队中抛可展示错误", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const outsider = await makeUser("outsider@example.com");

    await expect(updateMemberRole(owner.id, team.id, outsider.id, "teacher"))
      .rejects.toThrow("该成员不在团队中");
  });
});
