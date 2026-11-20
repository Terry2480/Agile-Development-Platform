"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// 登录页：未登录用户在此登录 / 注册 / 找回密码；已登录用户自动送回工作台
// （因此「登录新用户」必须先退出当前用户，符合产品要求）
type Mode = "login" | "register" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login"); // 登录 / 注册 / 找回密码
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);       // 找回密码：1 填邮箱 2 填验证码+新密码
  const [devCode, setDevCode] = useState("");        // 演示模式下返回的验证码

  // 已登录则直接回工作台
  useEffect(() => {
    fetch("/api/auth/me").then((res) => { if (res.ok) router.replace("/"); });
  }, [router]);

  function switchMode(next: Mode) {
    setMode(next); setError(""); setNotice(""); setStep(1); setDevCode("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "forgot" && step === 1) {
        // 第一步：发送验证码
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: values.email }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "发送失败，请重试"); return; }
        setNotice(data.message ?? "验证码已生成");
        if (data.devCode) { setDevCode(data.devCode); setValues({ ...values, code: "" }); setStep(2); }
        return;
      }
      if (mode === "forgot" && step === 2) {
        // 第二步：重置密码
        const res = await fetch("/api/auth/reset-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: values.email, code: values.code, newPassword: values.newPassword }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "重置失败，请重试"); return; }
        switchMode("login");
        setNotice("密码已重置，请用新密码登录");
        setValues({ email: values.email, password: "" });
        return;
      }
      // 登录 / 注册
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "操作失败，请重试"); return; }
      router.replace("/"); // 登录 / 注册成功，进入工作台
    } finally { setBusy(false); }
  }

  const field = (name: string, label: string, type = "text", placeholder = "") => (
    <label key={name}>{label}<input required type={type} value={values[name] ?? ""} placeholder={placeholder}
      onChange={(e) => setValues({ ...values, [name]: e.target.value })} /></label>
  );

  const isForgot = mode === "forgot";
  const tabTitle = isForgot ? (step === 1 ? "找回密码" : "设置新密码") : "";

  return <main className="auth-page">
    <div className="auth-card">
      <div className="app-brand" style={{ marginBottom: 26 }}>
        <span>A</span><div><b>AgileCampus</b><small>敏捷项目工作台</small></div>
      </div>
      <div className="auth-tabs">
        <button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登 录</button>
        <button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注 册</button>
        {isForgot && <button className="active auth-forgot-tab" onClick={() => { setStep(1); setError(""); }}>{tabTitle}</button>}
      </div>
      <form onSubmit={submit}>
        <div className="form-fields" style={{ marginTop: 22 }}>
          {mode === "register" && field("studentId", "学工号", "text", "请输入学工号")}
          {field("email", "邮箱", "email", "example@stu.edu.cn")}
          {mode === "login" && field("password", "密码", "password", "请输入密码")}
          {mode === "register" && field("password", "密码", "password", "至少 6 位")}
          {isForgot && step === 2 && (
            <>
              {devCode && (
                <div className="auth-devcode" role="status">
                  <small>演示验证码（项目未接入邮件服务）</small>
                  <b>{devCode}</b>
                </div>
              )}
              {field("code", "验证码", "text", "6 位验证码")}
              {field("newPassword", "新密码", "password", "至少 6 位")}
            </>
          )}
        </div>
        {isForgot && step === 1 && (
          <button type="button" className="auth-back" onClick={() => switchMode("login")}>← 返回登录</button>
        )}
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}
        <button className="primary full" type="submit" disabled={busy}>
          {busy ? "请稍候…" : isForgot ? (step === 1 ? "获取验证码" : "确认重置") : mode === "login" ? "登录工作台" : "注册并登录"}
        </button>
      </form>
      {mode === "login" && (
        <button className="auth-forgot-link" onClick={() => switchMode("forgot")}>忘记密码？</button>
      )}
      <p className="auth-hint">无需填写真实姓名——注册后可在「个人设置」中设置展示名称，以及性别、地区与个人简介</p>
    </div>
  </main>;
}
