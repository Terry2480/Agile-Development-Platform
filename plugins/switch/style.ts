// Switch 插件样式：由插件自建 <style> 注入，停用时与 UI 一并移除。
// 全部颜色走平台 --ws-color-* 令牌（含回退值），昼夜主题下均可读。

export const SWITCH_CSS = `
.sw-launcher{position:fixed;left:22px;bottom:76px;z-index:61;display:flex;align-items:center;gap:7px;height:44px;padding:0 16px 0 12px;border:0;border-radius:24px;background:linear-gradient(135deg,#294a78,#3d6ab5);color:#fff;box-shadow:0 8px 24px #294a7855;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;transition:transform .15s,box-shadow .15s}
.sw-launcher:hover{transform:translateY(-1px);box-shadow:0 10px 28px #294a7866}
.sw-launcher__dot{width:8px;height:8px;border-radius:50%;background:#7ef0b2;box-shadow:0 0 8px #7ef0b288}

.sw-panel{position:fixed;left:22px;bottom:132px;z-index:65;display:flex;flex-direction:column;width:min(400px,calc(100vw - 44px));height:min(640px,calc(100vh - 176px));background:var(--ws-color-141620,#141620);border:1px solid var(--ws-color-2a2d3d,#2a2d3d);border-radius:16px;box-shadow:-24px 0 70px rgba(0,0,0,.45);overflow:hidden;color:var(--ws-color-e8eaf2,#e8eaf2);font-family:inherit}
.sw-panel[hidden]{display:none}
@media (max-width:560px){.sw-panel{left:12px;bottom:128px;width:calc(100vw - 24px)}}

.sw-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--ws-color-262a38,#262a38)}
.sw-head__title{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;white-space:nowrap}
.sw-agent-select{flex:1;min-width:0;height:30px;border:1px solid var(--ws-color-262a38,#262a38);border-radius:8px;background:var(--ws-color-1d2030,#1d2030);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:12px;padding:0 6px;cursor:pointer}
.sw-icon-btn{flex:none;width:30px;height:30px;border:1px solid var(--ws-color-262a38,#262a38);border-radius:8px;background:var(--ws-color-1d2030,#1d2030);color:var(--ws-color-c6cbdb,#c6cbdb);font-size:13px;cursor:pointer}
.sw-icon-btn:hover{border-color:var(--ws-color-4a4f60,#4a4f60);color:var(--ws-color-e8eaf2,#e8eaf2)}

.sw-chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--ws-color-262a38,#262a38)}
.sw-chip{border:1px solid var(--ws-color-262a38,#262a38);border-radius:999px;background:var(--ws-color-1d2030,#1d2030);color:var(--ws-color-c6cbdb,#c6cbdb);font-size:12px;padding:4px 10px;cursor:pointer;font-family:inherit}
.sw-chip:hover{border-color:var(--ws-color-6f9bff,#6f9bff);color:var(--ws-color-e8eaf2,#e8eaf2)}

.sw-messages{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.sw-empty{margin:auto;text-align:center;color:var(--ws-color-c6cbdb,#c6cbdb);font-size:13px;line-height:1.7;padding:0 18px}
.sw-msg{max-width:88%;display:flex;flex-direction:column}
.sw-msg--user{align-self:flex-end;align-items:flex-end}
.sw-msg--assistant{align-self:flex-start;align-items:flex-start}
.sw-msg__body{padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow-y:auto}
.sw-msg--user .sw-msg__body{background:linear-gradient(135deg,#294a78,#3d6ab5);color:#fff;border-bottom-right-radius:4px}
.sw-msg--assistant .sw-msg__body{background:var(--ws-color-1d2030,#1d2030);color:var(--ws-color-e8eaf2,#e8eaf2);border-bottom-left-radius:4px}
.sw-msg__body--typing::after{content:"▍";color:var(--ws-color-6f9bff,#6f9bff);animation:sw-blink 1s steps(2) infinite}
.sw-msg__body--error{color:#ffb4b4;border:1px solid rgba(255,143,143,.35)}
@keyframes sw-blink{50%{opacity:0}}

.sw-composer{display:flex;gap:8px;padding:10px 14px 12px;border-top:1px solid var(--ws-color-262a38,#262a38)}
.sw-input{flex:1;min-height:40px;max-height:120px;resize:vertical;border:1px solid var(--ws-color-262a38,#262a38);border-radius:10px;background:var(--ws-color-0d0e14,#0d0e14);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:13px;font-family:inherit;padding:9px 11px;line-height:1.5}
.sw-input:focus{outline:none;border-color:var(--ws-color-6f9bff,#6f9bff)}
.sw-send{flex:none;border:0;border-radius:10px;background:linear-gradient(135deg,#294a78,#3d6ab5);color:#fff;font-size:13px;font-weight:600;padding:0 16px;cursor:pointer;font-family:inherit}
.sw-send:hover{filter:brightness(1.08)}
.sw-send--stop{background:var(--ws-color-1d2030,#1d2030);border:1px solid var(--ws-color-4a4f60,#4a4f60)}

.sw-view{flex:1;display:flex;flex-direction:column;overflow:hidden}
.sw-view[hidden]{display:none}
.sw-subhead{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--ws-color-262a38,#262a38);font-size:13px;color:var(--ws-color-c6cbdb,#c6cbdb)}
.sw-subhead b{color:var(--ws-color-e8eaf2,#e8eaf2)}
.sw-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.sw-agent-item{border:1px solid var(--ws-color-262a38,#262a38);border-radius:10px;background:var(--ws-color-1d2030,#1d2030);padding:9px 11px;cursor:pointer}
.sw-agent-item:hover{border-color:var(--ws-color-4a4f60,#4a4f60)}
.sw-agent-item.sw-agent-item--active{border-color:var(--ws-color-6f9bff,#6f9bff);box-shadow:inset 0 0 0 1px var(--ws-color-6f9bff,#6f9bff)}
.sw-agent-item__row{display:flex;align-items:center;gap:8px}
.sw-agent-item__name{font-size:13px;font-weight:600}
.sw-agent-item__meta{font-size:11px;color:var(--ws-color-c6cbdb,#c6cbdb);margin-top:3px;display:flex;flex-wrap:wrap;gap:4px 8px}
.sw-agent-item__ops{margin-left:auto;display:flex;gap:6px}
.sw-mini-btn{border:1px solid var(--ws-color-262a38,#262a38);border-radius:7px;background:transparent;color:var(--ws-color-c6cbdb,#c6cbdb);font-size:11px;padding:3px 8px;cursor:pointer;font-family:inherit}
.sw-mini-btn:hover{border-color:var(--ws-color-4a4f60,#4a4f60);color:var(--ws-color-e8eaf2,#e8eaf2)}
.sw-mini-btn--danger:hover{border-color:#ff8f8f;color:#ffb4b4}
.sw-active-dot{font-size:11px;color:var(--ws-color-6f9bff,#6f9bff)}
.sw-add-btn{margin:4px 2px 8px;border:1px dashed var(--ws-color-4a4f60,#4a4f60);border-radius:10px;background:transparent;color:var(--ws-color-c6cbdb,#c6cbdb);font-size:13px;padding:9px;cursor:pointer;font-family:inherit}
.sw-add-btn:hover{border-color:var(--ws-color-6f9bff,#6f9bff);color:var(--ws-color-e8eaf2,#e8eaf2)}

.sw-form{border-top:1px solid var(--ws-color-262a38,#262a38);padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--ws-color-141722,#141722)}
.sw-form[hidden]{display:none}
.sw-field{display:flex;flex-direction:column;gap:4px}
.sw-field label{font-size:11px;color:var(--ws-color-c6cbdb,#c6cbdb)}
.sw-field input,.sw-field select{height:32px;border:1px solid var(--ws-color-262a38,#262a38);border-radius:8px;background:var(--ws-color-0d0e14,#0d0e14);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:12px;padding:0 9px;font-family:inherit}
.sw-field input:focus,.sw-field select:focus{outline:none;border-color:var(--ws-color-6f9bff,#6f9bff)}
.sw-form__ops{display:flex;gap:8px;justify-content:flex-end}
.sw-foot-note{padding:8px 14px 10px;font-size:11px;color:var(--ws-color-c6cbdb,#c6cbdb);line-height:1.6;border-top:1px solid var(--ws-color-262a38,#262a38)}

.sw-doc-item{text-align:left;border:1px solid var(--ws-color-262a38,#262a38);border-radius:10px;background:var(--ws-color-1d2030,#1d2030);padding:9px 11px;cursor:pointer;color:var(--ws-color-e8eaf2,#e8eaf2);font-family:inherit}
.sw-doc-item:hover{border-color:var(--ws-color-6f9bff,#6f9bff)}
.sw-doc-item b{display:block;font-size:13px}
.sw-doc-item small{display:block;font-size:11px;color:var(--ws-color-c6cbdb,#c6cbdb);margin-top:3px;line-height:1.5}
.sw-doc-empty{margin:auto;color:var(--ws-color-c6cbdb,#c6cbdb);font-size:13px;text-align:center;line-height:1.7;padding:0 18px}

.sw-toast{position:absolute;left:50%;bottom:74px;transform:translateX(-50%);max-width:86%;background:var(--ws-color-1d2030,#1d2030);border:1px solid var(--ws-color-4a4f60,#4a4f60);color:var(--ws-color-e8eaf2,#e8eaf2);font-size:12px;border-radius:8px;padding:6px 12px;z-index:66;pointer-events:none;box-shadow:0 8px 22px rgba(0,0,0,.4)}
.sw-toast--error{border-color:#ff8f8f;color:#ffb4b4}
.sw-toast[hidden]{display:none}
`;
