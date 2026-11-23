"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BG_PRESETS, useCustomBg, setCustomBg, type CustomBgSetting } from "@/components/CustomBackground";

type Profile = { name: string; studentId: string; gender: string; region: string; bio: string };

// 修改密码卡片：验证当前密码后更新；其他设备会被强制重新登录
function PasswordCard() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    if (form.newPassword !== form.confirm) { setError("两次输入的新密码不一致"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error ?? "修改失败，请重试"); return; }
      setMsg("密码已修改，其他设备需要重新登录");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch {
      setError("无法连接服务器，请检查网络后重试");
    } finally { setBusy(false); }
  }

  return (
    <section className="appearance-card">
      <h2>修改密码</h2>
      <p className="appearance-tip">修改成功后，其他已登录的设备会自动退出，需要用新密码重新登录。</p>
      <form onSubmit={submit} className="appearance-image" style={{ flexDirection: "column", gap: 8, alignItems: "stretch" }}>
        <input className="ws-input" type="password" required value={form.currentPassword} placeholder="当前密码" aria-label="当前密码"
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <input className="ws-input" type="password" required minLength={6} value={form.newPassword} placeholder="新密码（至少 6 位）" aria-label="新密码"
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <input className="ws-input" type="password" required value={form.confirm} placeholder="确认新密码" aria-label="确认新密码"
          onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        {error && <p className="ws-error" role="alert">{error}</p>}
        {msg && <p role="status" style={{ color: "#2fae7d", fontSize: 12 }}>{msg}</p>}
        <div><button className="ws-btn primary" type="submit" disabled={busy || !form.currentPassword || form.newPassword.length < 6}>
          {busy ? "提交中…" : "修改密码"}</button></div>
      </form>
    </section>
  );
}

// 外观自定义卡片：全站背景（预设渐变色板 / 自定义图片 URL），写入即全站生效
function AppearanceCard() {
  const bg = useCustomBg();
  const [imageUrl, setImageUrl] = useState("");

  const apply = (setting: CustomBgSetting) => { setCustomBg(setting); };
  const activeGradient = bg.mode === "gradient" ? bg.value : "";
  const activeImage = bg.mode === "image" ? bg.value : "";

  return (
    <section className="appearance-card">
      <h2>外观自定义</h2>
      <p className="appearance-tip">选择一个全站背景氛围色，或填入图片链接。设置立即生效、随时清除，仅保存在你自己的浏览器里。</p>
      <div className="appearance-swatches">
        {BG_PRESETS.map((p) => (
          <button
            key={p.name}
            className={`appearance-swatch ${activeGradient === p.value ? "on" : ""}`}
            style={{ backgroundImage: p.value }}
            title={p.name}
            aria-label={`背景：${p.name}`}
            onClick={() => apply({ mode: "gradient", value: p.value })}
          >
            {activeGradient === p.value ? "✓" : ""}
          </button>
        ))}
      </div>
      <div className="appearance-image">
        <input
          className="ws-input"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="图片链接（https://…），留空则不使用图片背景"
          aria-label="自定义背景图片链接"
        />
        <button className="ws-btn" type="button" disabled={!imageUrl.trim()} onClick={() => apply({ mode: "image", value: imageUrl.trim() })}>应用图片</button>
      </div>
      {(bg.mode !== "none" || activeImage) && (
        <button className="appearance-clear" type="button" onClick={() => { apply({ mode: "none", value: "" }); setImageUrl(""); }}>恢复默认背景</button>
      )}
      <button
        className="appearance-clear"
        type="button"
        title="恢复被右键屏蔽的新手导引悬浮入口"
        onClick={() => {
          try { window.localStorage.removeItem("agile-guide-launcher-blocked"); } catch { /* 忽略 */ }
          window.location.reload();
        }}
      >
        恢复「新手导引」入口
      </button>
    </section>
  );
}

// 个人设置页：仅显示并允许修改「当前登录用户自己」的资料（服务端同样只接受本人提交）
export default function SettingsPage() {
  const router = useRouter();
  const [values, setValues] = useState<Profile>({ name: "", studentId: "", gender: "", region: "", bio: "" });
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false); // 「已保存」小提示
  const [busy, setBusy] = useState(false);

  // 未登录跳登录页；已登录则载入自己的资料
  useEffect(() => {
    fetch("/api/auth/me").then(async (res) => {
      if (!res.ok) { router.replace("/login"); return; }
      const { user } = await res.json();
      setEmail(user.email);
      setValues({ name: user.name ?? "", studentId: user.studentId ?? "", gender: user.gender ?? "",
        region: user.region ?? "", bio: user.bio ?? "" });
    });
  }, [router]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setSaved(false); setBusy(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "保存失败，请重试"); return; }
      setSaved(true); // 保存成功，姓名改动会同步显示到工作台头像菜单
    } finally { setBusy(false); }
  }

  const set = (key: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues({ ...values, [key]: e.target.value });

  return <main className="settings-page">
    <div className="settings-card">
      <div className="settings-head">
        <div>
          <span className="breadcrumb">个人设置 / {values.name || values.studentId || "…"}</span>
          <h1>个人设置</h1>
        </div>
        <button className="ws-btn" onClick={() => router.push("/")}>← 返回工作台</button>
      </div>
      <p className="settings-tip">登录邮箱：{email || "…"}（邮箱不可修改）；以下资料仅本人可更改</p>
      <form onSubmit={save}>
        <div className="settings-grid">
          <label>名称<input className="ws-input" value={values.name} onChange={set("name")} placeholder="展示名称，可不填（默认显示学工号）" /></label>
          <label>学工号<input className="ws-input" required value={values.studentId} onChange={set("studentId")} placeholder="例如：2023210315" /></label>
          <label>性别<select className="ws-select" value={values.gender} onChange={set("gender")}>
            <option value="">未设置</option><option value="男">男</option><option value="女">女</option><option value="保密">保密</option>
          </select></label>
          <label>地区<input className="ws-input" value={values.region} onChange={set("region")} placeholder="例如：福建 福州" /></label>
          <label className="span2">个人简介<textarea className="ws-textarea" rows={4} value={values.bio} onChange={set("bio")} placeholder="介绍一下自己，让队友更了解你（研究方向、擅长技能、担当角色等）" /></label>
        </div>
        {error && <p className="ws-error" role="alert">{error}</p>}
        <div className="settings-actions">
          {saved && <span className="save-hint">已保存 ✓</span>}
          <button className="ws-btn primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button>
        </div>
      </form>

      <PasswordCard />

      {/* 外观自定义：全站背景（氛围层），立即生效、随时清除 */}
      <AppearanceCard />
    </div>
  </main>;
}
