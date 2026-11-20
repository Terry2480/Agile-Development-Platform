"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { renderReport, reportPreset, reportRangeSchema, type ReportSummary } from "@/lib/report-summary";

export function ReportPanel({ projectId }: { projectId: number }) {
  const [range, setRange] = useState(() => reportPreset("week"));
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  async function generate() {
    if (!reportRangeSchema.safeParse(range).success) return setError("请选择有效的日期范围，开始日期不能晚于结束日期。");
    const id = ++requestId.current;
    setBusy(true); setError("");
    try {
      const data = await api<{ report: ReportSummary }>(`/api/projects/${projectId}/report?${new URLSearchParams(range)}`);
      if (requestId.current === id) setReport(data.report);
    } catch (e) { if (requestId.current === id) setError((e as Error).message); }
    finally { if (requestId.current === id) setBusy(false); }
  }
  return <section className="ws-space-section ws-report">
    <div className="ws-panel-head"><h2>汇报摘要</h2><button className="ws-btn primary" disabled={busy} onClick={generate}>{busy ? "生成中…" : "生成 / 刷新摘要"}</button></div>
    <p className="ws-team-note">汇总期间完成情况和当前项目进度，补充说明后可直接用于课堂汇报。</p>
    <div className="ws-report-controls">
      <button className="ws-btn" disabled={busy} onClick={() => setRange(reportPreset("week"))}>本周</button><button className="ws-btn" disabled={busy} onClick={() => setRange(reportPreset("lastWeek"))}>上周</button><button className="ws-btn" disabled={busy} onClick={() => setRange(reportPreset("month"))}>本月</button>
      <label>开始日期<input className="ws-input" type="date" disabled={busy} value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></label><label>结束日期<input className="ws-input" type="date" disabled={busy} value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></label>
    </div>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {!report && <div className="ws-empty">选择汇报时间范围，点击「生成 / 刷新摘要」。</div>}
    {report && (report.start !== range.start || report.end !== range.end) && <p className="ws-team-note">日期范围已调整，请重新生成摘要。</p>}
    {report && report.start === range.start && report.end === range.end && <ReportDraft key={`${projectId}:${report.start}:${report.end}`} projectId={projectId} report={report} />}
  </section>;
}

function ReportDraft({ projectId, report }: { projectId: number; report: ReportSummary }) {
  const key = `agile-report:${projectId}:${report.start}:${report.end}`;
  const [blockers, setBlockers] = useState("");
  const [plan, setPlan] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try { const stored = JSON.parse(localStorage.getItem(key) || "{}"); if (typeof stored.blockers === "string") setBlockers(stored.blockers); if (typeof stored.plan === "string") setPlan(stored.plan); }
      catch { setNotice("无法读取本地草稿，可以继续填写并下载保存。"); }
      setReady(true);
    });
    return () => { active = false; };
  }, [key]);
  function update(nextBlockers: string, nextPlan: string) {
    setBlockers(nextBlockers); setPlan(nextPlan);
    try { localStorage.setItem(key, JSON.stringify({ blockers: nextBlockers, plan: nextPlan })); setNotice("说明草稿已保存到当前浏览器。"); }
    catch { setNotice("浏览器无法保存草稿，请复制或下载汇报内容。"); }
  }
  const text = renderReport(report, blockers, plan);
  async function copy() { try { await navigator.clipboard.writeText(text); setNotice("汇报内容已复制。"); } catch { setNotice("复制失败，请在下方选中内容复制，或下载文件。"); } }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `项目汇报-${report.start}-${report.end}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已下载 Markdown 文件。");
  }
  return <>
    <div className="ws-report-stats"><span>期间完成 <b>{report.completed.length}</b></span><span>当前进行中 <b>{report.doing.length}</b></span><span>当前逾期 <b>{report.overdue.length}</b></span></div>
    <div className="ws-field"><label htmlFor="report-blockers">阻碍与需要协助的问题</label><textarea id="report-blockers" className="ws-textarea" disabled={!ready} maxLength={5000} placeholder="例如：接口联调受阻，需要确认数据格式。" value={blockers} onChange={(e) => update(e.target.value, plan)} /></div>
    <div className="ws-field"><label htmlFor="report-plan">下一步计划</label><textarea id="report-plan" className="ws-textarea" disabled={!ready} maxLength={5000} placeholder="例如：下周完成测试并准备中期演示。" value={plan} onChange={(e) => update(blockers, e.target.value)} /></div>
    <p className="ws-team-note">补充说明仅保存在当前浏览器，不会自动共享给团队。生成后请检查汇报内容。</p>
    <div className="ws-management-actions"><button className="ws-btn" disabled={!ready} onClick={copy}>复制汇报</button><button className="ws-btn" disabled={!ready} onClick={download}>下载 Markdown</button></div>
    {notice && <p className="ws-team-note" role="status">{notice}</p>}
    <label className="ws-team-note" htmlFor="report-preview">汇报预览</label><textarea id="report-preview" className="ws-report-preview" readOnly value={text} />
  </>;
}
