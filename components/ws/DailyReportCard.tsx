"use client";

// AI 日报卡片：「今日」首页的智能摘要——聚合项目动态 / 临近截止 / 提及与我 / 里程碑，
// 由本地规则引擎（lib/home-report.ts）生成，30 秒轮询保持实时，页面后台时暂停。
import { useCallback, useEffect, useState } from "react";
import { api, dayKey } from "@/lib/api-client";
import { useWorkspace, Icon } from "./shared";
import type { DailyReport } from "@/lib/home-report";

export function DailyReportCard() {
  const ws = useWorkspace();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState("");

  // 与后端 /api/home/daily-report 缺省口径一致：统一用东八区（Asia/Hong_Kong）当天
  const localDateKey = () => dayKey(new Date().toISOString());

  const load = useCallback(() => {
    api<{ report: DailyReport }>(`/api/home/daily-report?date=${localDateKey()}`)
      .then((d) => { setReport(d.report); setFailed(""); })
      .catch((e: Error) => { setFailed(e.message); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // 30 秒轮询；后台标签页暂停，回到前台立即刷新一次
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const sections = report?.sections ?? [];
  const visibleSections = expanded ? sections : sections.slice(0, 2);
  const hiddenCount = sections.length - visibleSections.length;

  return (
    <section className="ws-today-card ws-report">
      <h2>
        <Icon name="sparkles" size={14} /> AI 日报
        <span className="ws-count-pill">实时</span>
        <button
          className="ws-icon-btn"
          style={{ marginLeft: "auto" }}
          title="重新生成"
          aria-label="重新生成日报"
          onClick={() => { setReport(null); load(); }}
        >
          <Icon name="refresh" size={13} />
        </button>
      </h2>
      {!report && !failed && <div className="ws-empty" style={{ padding: 18 }}>正在汇总今天的工作区数据…</div>}
      {failed && <div className="ws-error" role="alert" style={{ margin: 4 }}>日报生成失败：{failed}</div>}
      {report && (
        <>
          <div className="ws-report-headline">{report.headline}</div>
          <p className="ws-report-summary">{report.summary}</p>
          {visibleSections.map((sec) => (
            <div key={sec.key} className="ws-report-sec">
              <h3>{sec.title}</h3>
              {sec.lines.map((line, i) => (
                <div key={i} className="ws-report-line">{line}</div>
              ))}
            </div>
          ))}
          {(hiddenCount > 0 || expanded) && (
            <button className="ws-report-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "收起日报" : `展开全部（还有 ${hiddenCount} 节）`}
            </button>
          )}
          {report.focusItems.length > 0 && (
            <div className="ws-report-focus">
              <h3><Icon name="flag" size={12} /> 建议优先处理</h3>
              {report.focusItems.map((f, i) => <div key={i} className="ws-report-line">{i + 1}. {f}</div>)}
            </div>
          )}
          <div className="ws-report-foot">由 AgileCampus 智能助手基于工作区实时数据生成 · {ws.me.name || ws.me.studentId}</div>
        </>
      )}
    </section>
  );
}
