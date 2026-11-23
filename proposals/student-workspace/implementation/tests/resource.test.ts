import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import {
  createResourceUsage,
  endResourceUsage,
  listTeamResourceUsages,
} from "@/lib/resource";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  return { owner, team, student, teacher, outsider };
}

const H = (h: number) => new Date(`2026-07-22T0${h}:00:00Z`);

describe("createResourceUsage", () => {
  beforeEach(resetDb);

  it("成员可登记占用（起止齐全）", async () => {
    const { student, team } = await scene();
    const u = await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      purpose: "训练模型",
      startTime: H(1),
      endTime: H(4),
    });
    expect(u.resourceName).toBe("GPU-01");
    expect(u.userId).toBe(student.id);
    expect(u.endTime).not.toBeNull();
  });

  it("可登记进行中占用（endTime 省略）", async () => {
    const { student, team } = await scene();
    const u = await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
    });
    expect(u.endTime).toBeNull();
  });

  it("teacher 亦可登记（占用不分角色）", async () => {
    const { teacher, team } = await scene();
    const u = await createResourceUsage(teacher.id, team.id, {
      resourceName: "示波器",
      startTime: H(1),
    });
    expect(u.userId).toBe(teacher.id);
  });

  it("非成员登记被拒", async () => {
    const { outsider, team } = await scene();
    await expect(
      createResourceUsage(outsider.id, team.id, { resourceName: "GPU-01", startTime: H(1) }),
    ).rejects.toThrow("没有权限");
  });

  it("资源名为空被拒", async () => {
    const { student, team } = await scene();
    await expect(
      createResourceUsage(student.id, team.id, { resourceName: "   ", startTime: H(1) }),
    ).rejects.toThrow("资源名");
  });

  it("结束时间早于开始时间被拒", async () => {
    const { student, team } = await scene();
    await expect(
      createResourceUsage(student.id, team.id, {
        resourceName: "GPU-01",
        startTime: H(4),
        endTime: H(1),
      }),
    ).rejects.toThrow("结束时间");
  });
});

describe("endResourceUsage", () => {
  beforeEach(resetDb);

  it("登记者本人可结束进行中占用", async () => {
    const { student, team } = await scene();
    const u = await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
    });
    const ended = await endResourceUsage(student.id, u.id);
    expect(ended.endTime).not.toBeNull();
  });

  it("团队 admin 可结束他人占用（管理权）", async () => {
    const { owner, student, team } = await scene();
    const u = await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
    });
    const ended = await endResourceUsage(owner.id, u.id);
    expect(ended.endTime).not.toBeNull();
  });

  it("他人（非 admin）结束占用被拒", async () => {
    const { student, teacher, team } = await scene();
    const u = await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
    });
    await expect(endResourceUsage(teacher.id, u.id)).rejects.toThrow("没有权限");
  });

  it("结束已结束的占用被拒", async () => {
    const { student, team } = await scene();
    const u = await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
      endTime: H(2),
    });
    await expect(endResourceUsage(student.id, u.id)).rejects.toThrow("已结束");
  });
});

describe("listTeamResourceUsages", () => {
  beforeEach(resetDb);

  it("列出团队占用（倒序），标注进行中，附姓名", async () => {
    const { student, team } = await scene();
    await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
      endTime: H(3),
    });
    await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-02",
      startTime: H(5),
    });
    const { usages } = await listTeamResourceUsages(student.id, team.id);
    expect(usages).toHaveLength(2);
    expect(usages[0].resourceName).toBe("GPU-02"); // 倒序（近者在前）
    expect(usages[0].active).toBe(true);
    expect(usages[1].active).toBe(false);
    expect(usages[1].userName).toBe("student");
    expect(usages[1].durationMinutes).toBe(120); // 1→3 时 = 120 分钟
  });

  it("汇总每人/每资源时长（仅计已结束占用）", async () => {
    const { owner, student, team } = await scene();
    await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(1),
      endTime: H(3),
    }); // student GPU-01 120min
    await createResourceUsage(owner.id, team.id, {
      resourceName: "GPU-01",
      startTime: H(3),
      endTime: H(4),
    }); // owner GPU-01 60min
    await createResourceUsage(student.id, team.id, {
      resourceName: "GPU-02",
      startTime: H(5),
    }); // 进行中，不计

    const { byUser, byResource } = await listTeamResourceUsages(student.id, team.id);
    expect(byUser.find((r) => r.userId === student.id)?.totalMinutes).toBe(120);
    expect(byUser.find((r) => r.userId === owner.id)?.totalMinutes).toBe(60);
    expect(byResource.find((r) => r.resourceName === "GPU-01")?.totalMinutes).toBe(180);
    expect(byResource.find((r) => r.resourceName === "GPU-02")?.totalMinutes ?? 0).toBe(0);
  });

  it("非成员查看被拒", async () => {
    const { outsider, team } = await scene();
    await expect(listTeamResourceUsages(outsider.id, team.id)).rejects.toThrow("没有权限");
  });
});
