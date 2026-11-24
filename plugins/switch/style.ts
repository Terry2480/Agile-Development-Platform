// Switch 插件样式：由插件自建 <style> 注入，停用时与 UI 一并移除。
// 入口在工作台左侧功能列（railEntry），不再使用悬浮球。
// 控件表面/描边用 .sw-panel 上的局部变量定义，并按 html[data-theme="day"]
// 整套切换——夜间提亮边框与底色、日间用暖棕描边，保证两种主题下
// 交互控件都与面板背景明显区分（平台令牌在日间多为近色，直接引用会看不清）。
// 强调色沿用平台 --ws-color-6f9bff 令牌（夜间蓝 / 日间暖橙）。

export const SWITCH_CSS = `
.sw-panel{
  --sw-surface:#232838;      /* 控件底色（比面板亮一档） */
  --sw-line:#4d566d;         /* 控件描边（静止即可见，对面板≈2.4:1） */
  --sw-line-strong:#616d8a;  /* 控件描边（悬停） */
  --sw-divider:#262a38;      /* 区块分隔线（比描边弱一档） */
  --sw-text-2:#aab2c5;
  position:fixed;left:22px;bottom:22px;z-index:65;display:flex;flex-direction:column;
  width:min(400px,calc(100vw - 44px));height:min(640px,calc(100vh - 66px));
  background:var(--ws-color-141620,#141620);border:1px solid var(--sw-line);
  border-radius:16px;box-shadow:-24px 0 70px rgba(0,0,0,.45);overflow:hidden;
  color:var(--ws-color-e8eaf2,#e8eaf2);font-family:inherit;
}
html[data-theme="day"] .sw-panel{
  --sw-surface:#f6ebdb;
  --sw-line:#a06f3f;         /* 暖棕描边，对米色面板≈3.4:1（平台日间令牌多为近色，不可直接引用） */
  --sw-line-strong:#8a5c2e;
  --sw-divider:#b98d5e;      /* 分隔线用弱一档的暖棕，避免与描边同重 */
  --sw-text-2:#6b4a26;
  box-shadow:-24px 0 70px rgba(120,80,30,.25);
}
.sw-panel[hidden]{display:none}
@media (max-width:560px){.sw-panel{left:12px;bottom:12px;width:calc(100vw - 24px);height:min(640px,calc(100vh - 40px))}}

.sw-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--sw-divider)}
.sw-head__title{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;white-space:nowrap}
.sw-agent-select{flex:1;min-width:0;height:32px;border:1px solid var(--sw-line);border-radius:8px;background:var(--sw-surface);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:12px;padding:0 6px;cursor:pointer}
.sw-agent-select:hover{border-color:var(--sw-line-strong)}
.sw-icon-btn{flex:none;width:32px;height:32px;border:1px solid var(--sw-line);border-radius:8px;background:var(--sw-surface);color:var(--ws-color-c6cbdb,#c6cbdb);font-size:13px;cursor:pointer}
.sw-icon-btn:hover{border-color:var(--sw-line-strong);color:var(--ws-color-e8eaf2,#e8eaf2);background:var(--sw-surface)}

.sw-chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--sw-divider)}
.sw-chip{border:1px solid var(--sw-line);border-radius:999px;background:var(--sw-surface);color:var(--ws-color-c6cbdb,#c6cbdb);font-size:12px;padding:4px 10px;cursor:pointer;font-family:inherit}
.sw-chip:hover{border-color:var(--ws-color-6f9bff,#6f9bff);color:var(--ws-color-e8eaf2,#e8eaf2)}

.sw-messages{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.sw-empty{margin:auto;text-align:center;color:var(--sw-text-2);font-size:13px;line-height:1.7;padding:0 18px}
.sw-msg{max-width:88%;display:flex;flex-direction:column}
.sw-msg--user{align-self:flex-end;align-items:flex-end}
.sw-msg--assistant{align-self:flex-start;align-items:flex-start}
.sw-msg__body{padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto}
.sw-msg--user .sw-msg__body{background:linear-gradient(135deg,#294a78,#3d6ab5);color:#fff;border-bottom-right-radius:4px}
.sw-msg--assistant .sw-msg__body{background:var(--sw-surface);border:1px solid var(--sw-line);color:var(--ws-color-e8eaf2,#e8eaf2);border-bottom-left-radius:4px}
.sw-msg__body--typing::after{content:"▍";color:var(--ws-color-6f9bff,#6f9bff);animation:sw-blink 1s steps(2) infinite}
.sw-msg__body--error{color:#ffb4b4;border:1px solid rgba(255,143,143,.35)}
html[data-theme="day"] .sw-msg__body--error{color:#b4371f}
@keyframes sw-blink{50%{opacity:0}}

.sw-composer{display:flex;gap:8px;align-items:flex-end;padding:10px 14px 12px;border-top:1px solid var(--sw-divider)}
.sw-input{flex:1;min-height:44px;max-height:150px;resize:none;overflow-y:auto;border:1px solid var(--sw-line);border-radius:10px;background:var(--ws-color-0d0e14,#0d0e14);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:13px;font-family:inherit;padding:10px 11px;line-height:1.5;transition:height .12s ease}
html[data-theme="day"] .sw-input{background:#fffaf2}
.sw-input:focus{outline:none;border-color:var(--ws-color-6f9bff,#6f9bff)}
.sw-input:disabled{opacity:.55}
.sw-send{flex:none;height:44px;border:0;border-radius:10px;background:linear-gradient(135deg,#294a78,#3d6ab5);color:#fff;font-size:13px;font-weight:600;padding:0 16px;cursor:pointer;font-family:inherit}
.sw-send:hover{filter:brightness(1.08)}
.sw-send--stop{background:var(--sw-surface);border:1px solid var(--sw-line-strong);color:var(--ws-color-e8eaf2,#e8eaf2)}

.sw-view{flex:1;display:flex;flex-direction:column;overflow:hidden}
.sw-view[hidden]{display:none}
.sw-subhead{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--sw-divider);font-size:13px;color:var(--sw-text-2)}
.sw-subhead b{color:var(--ws-color-e8eaf2,#e8eaf2)}
.sw-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.sw-agent-item{border:1px solid var(--sw-line);border-radius:10px;background:var(--sw-surface);padding:9px 11px;cursor:pointer}
.sw-agent-item:hover{border-color:var(--sw-line-strong)}
.sw-agent-item.sw-agent-item--active{border-color:var(--ws-color-6f9bff,#6f9bff);box-shadow:inset 0 0 0 1px var(--ws-color-6f9bff,#6f9bff)}
.sw-agent-item__row{display:flex;align-items:center;gap:8px}
.sw-agent-item__name{font-size:13px;font-weight:600}
.sw-agent-item__meta{font-size:11px;color:var(--sw-text-2);margin-top:3px;display:flex;flex-wrap:wrap;gap:4px 8px}
.sw-agent-item__ops{margin-left:auto;display:flex;gap:6px}
.sw-mini-btn{border:1px solid var(--sw-line);border-radius:7px;background:var(--sw-surface);color:var(--ws-color-c6cbdb,#c6cbdb);font-size:11px;padding:3px 8px;cursor:pointer;font-family:inherit}
.sw-mini-btn:hover{border-color:var(--sw-line-strong);color:var(--ws-color-e8eaf2,#e8eaf2)}
.sw-mini-btn--danger:hover{border-color:#ff8f8f;color:#ffb4b4}
html[data-theme="day"] .sw-mini-btn--danger:hover{border-color:#c94f2f;color:#b4371f}
.sw-active-dot{font-size:11px;color:var(--ws-color-6f9bff,#6f9bff)}
.sw-add-btn{margin:4px 2px 8px;border:1px dashed var(--sw-line-strong);border-radius:10px;background:transparent;color:var(--sw-text-2);font-size:13px;padding:9px;cursor:pointer;font-family:inherit}
.sw-add-btn:hover{border-color:var(--ws-color-6f9bff,#6f9bff);color:var(--ws-color-e8eaf2,#e8eaf2)}

.sw-form{border-top:1px solid var(--sw-divider);padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--ws-color-141722,#141722)}
html[data-theme="day"] .sw-form{background:#f2e6d5}
.sw-form[hidden]{display:none}
.sw-field{display:flex;flex-direction:column;gap:4px}
.sw-field label{font-size:11px;color:var(--sw-text-2)}
.sw-field input,.sw-field select{height:32px;border:1px solid var(--sw-line);border-radius:8px;background:var(--ws-color-0d0e14,#0d0e14);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:12px;padding:0 9px;font-family:inherit}
html[data-theme="day"] .sw-field input,html[data-theme="day"] .sw-field select{background:#fffaf2}
.sw-field input:focus,.sw-field select:focus{outline:none;border-color:var(--ws-color-6f9bff,#6f9bff)}
.sw-form__ops{display:flex;gap:8px;justify-content:flex-end}
.sw-foot-note{padding:8px 14px 10px;font-size:11px;color:var(--sw-text-2);line-height:1.6;border-top:1px solid var(--sw-divider)}

.sw-doc-item{text-align:left;border:1px solid var(--sw-line);border-radius:10px;background:var(--sw-surface);padding:9px 11px;cursor:pointer;color:var(--ws-color-e8eaf2,#e8eaf2);font-family:inherit}
.sw-doc-item:hover{border-color:var(--ws-color-6f9bff,#6f9bff)}
.sw-doc-item b{display:block;font-size:13px}
.sw-doc-item small{display:block;font-size:11px;color:var(--sw-text-2);margin-top:3px;line-height:1.5}
.sw-doc-empty{margin:auto;color:var(--sw-text-2);font-size:13px;text-align:center;line-height:1.7;padding:0 18px}

.sw-toast{position:absolute;left:50%;bottom:86px;transform:translateX(-50%);max-width:86%;background:var(--sw-surface);border:1px solid var(--sw-line-strong);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:12px;border-radius:8px;padding:6px 12px;z-index:66;pointer-events:none;box-shadow:0 8px 22px rgba(0,0,0,.4)}
.sw-toast--error{border-color:#ff8f8f;color:#ffb4b4}
html[data-theme="day"] .sw-toast--error{border-color:#c94f2f;color:#b4371f}
.sw-toast[hidden]{display:none}
`;
