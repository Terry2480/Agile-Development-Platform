"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Profile = { name: string; studentId: string; gender: string; region: string; bio: string };

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
    </div>
  </main>;
}
