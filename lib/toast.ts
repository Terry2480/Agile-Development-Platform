/* 轻量 Toast 事件总线：任意模块调 toast("文案") 即可弹出，无需层层传 props。
   ToastHost 组件订阅并渲染；错误级别停留更久。 */

export type ToastKind = "ok" | "error";
export interface ToastItem { id: number; text: string; kind: ToastKind }

type Listener = (item: ToastItem) => void;
let listeners: Listener[] = [];
let seq = 0;

export function toast(text: string, kind: ToastKind = "ok") {
  const item: ToastItem = { id: ++seq, text, kind };
  for (const listen of listeners) listen(item);
}

export function subscribeToast(listener: Listener): () => void {
  listeners.push(listener);
  return () => { listeners = listeners.filter((l) => l !== listener); };
}
