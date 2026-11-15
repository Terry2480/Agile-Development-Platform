"use client";

// 私信面板：飞书式双栏——左侧会话列表（未读角标、最后消息预览），右侧一对一消息流
// 联系人限于同团队成员；消息 8 秒轮询，会话列表随工作台全局轮询刷新
import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadFile, fmtDateShort, fmtTime, fmtSize, dayKey, type DmConversation, type DmContact, type DmMessage } from "@/lib/api-client";
import { useWorkspace, Icon, Avatar, Modal } from "./shared";
import { ConversationSkeleton } from "./LoadingSkeleton";
import { toast } from "@/lib/toast";

const EMOJIS = ["👍", "🎉", "😂", "🙏", "💪", "👀", "❤️", "🔥"];

type DmHit = {
  id: number;
  content: string;
  createdAt: string;
  senderId: number;
  senderName: string;
  mine: boolean;
  attachment: { id: number; name: string; size: number } | null;
};
type SearchType = "all" | "text" | "link" | "file" | "author";
const SEARCH_TABS: [SearchType, string][] = [["all", "全部"], ["text", "原文"], ["link", "链接"], ["file", "文件"], ["author", "人名"]];

export function MessagesPanel() {
  const ws = useWorkspace();
  const [activeId, setActiveId] = useState<number | null>(ws.dmTargetId);
  const [seenTarget, setSeenTarget] = useState<number | null>(ws.dmTargetId);
  const [showContacts, setShowContacts] = useState(false);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number; confirmDelete: boolean } | null>(null);

  // 外部入口（通知跳转 / 成员卡片「私信」/ 删除会话）变更目标时跟随（渲染期对齐，避免级联 effect）
  if (ws.dmTargetId !== seenTarget) {
    setSeenTarget(ws.dmTargetId);
    setActiveId(ws.dmTargetId);
  }

  // 右键 / ⋯ 打开会话菜单：浏览器给出的是缩放后的视觉坐标，除以缩放比换算回设计坐标
  function openMenu(id: number, visualX: number, visualY: number) {
    const frame = document.querySelector(".ws-scale-frame") as HTMLElement | null;
    const scale = frame && frame.offsetWidth > 0 ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
    const factor = scale > 0 ? scale : 1;
    const maxX = (frame?.offsetWidth ?? 1280) - 190;
    const maxY = (frame?.offsetHeight ?? 800) - 190;
    setMenu({ id, x: Math.min(visualX / factor, maxX), y: Math.min(visualY / factor, maxY), confirmDelete: false });
  }

  async function hideConversation(id: number) {
    try {
      await ws.hideDmConversation(id);
      if (activeId === id) setActiveId(null);
      toast("会话已隐藏，对方来新消息会自动恢复");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setMenu(null);
  }

  async function deleteConversation(id: number) {
    try {
      await ws.deleteDmConversation(id);
      if (activeId === id) setActiveId(null);
      toast("会话已删除");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setMenu(null);
  }

  // 菜单打开期间：点击任意处 / Esc / 窗口变化即关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  return (
    <div className="ws-dm">
      <aside className="ws-dm-list" aria-label="私信会话列表">
        <div className="ws-dm-list-head">
          <b>私信</b>
          <button className="ws-btn" style={{ padding: "6px 12px", fontSize: 12 }} title="发起私聊" onClick={() => setShowContacts(true)}>
            <Icon name="plus" size={13} /> 添加
          </button>
        </div>
        <div className="ws-dm-scroll">
          {!ws.dmsLoaded && <ConversationSkeleton rows={4} />}
          {ws.dmsLoaded && ws.dmConversations.length === 0 && (
            <div className="ws-empty" style={{ margin: 12 }}>还没有私信，点击「添加」找同团队的成员聊聊</div>
          )}
          {ws.dmConversations.map((c) => (
            <div
              key={c.id}
              className={`ws-dm-item ${activeId === c.id ? "active" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`与 ${c.partner.displayName} 的会话`}
              onClick={() => setActiveId(c.id)}
              onKeyDown={(e) => { if (e.key === "Enter") setActiveId(c.id); }}
              onContextMenu={(e) => { e.preventDefault(); openMenu(c.id, e.clientX, e.clientY); }}
            >
              <span className="ws-avatar-pos">
                <Avatar name={c.partner.displayName} colorKey={c.partner.userId} />
                <i className={`ws-online-dot ${c.partner.online ? "on" : ""}`} />
              </span>
              <span className="ws-dm-item-main">
                <span className="ws-dm-item-top">
                  <b>{c.partner.displayName}</b>
                  {c.lastMessage && <small>{listTime(c.lastMessage.createdAt)}</small>}
                </span>
                <span className="ws-dm-item-preview">
                  {c.lastMessage
                    ? `${c.lastMessage.senderId === ws.me.id ? "我：" : ""}${c.lastMessage.content}`
                    : "开始对话吧"}
                </span>
              </span>
              {c.unreadCount > 0 && <span className="ws-dm-unread">{c.unreadCount > 99 ? "99+" : c.unreadCount}</span>}
              <button
                className="ws-dm-more"
                title="会话选项"
                aria-label={`${c.partner.displayName} 的会话选项`}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  openMenu(c.id, rect.left, rect.bottom + 4);
                }}
              >
                <Icon name="more" size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {menu && (
        <div className="ws-dm-menu" role="menu" aria-label="会话选项" style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => void hideConversation(menu.id)}>
            隐藏会话
            <small>仅从我的列表移除；来新消息自动恢复</small>
          </button>
          <button role="menuitem" className="danger" onClick={() => {
            if (!menu.confirmDelete) { setMenu({ ...menu, confirmDelete: true }); return; }
            void deleteConversation(menu.id);
          }}>
            {menu.confirmDelete ? "确认删除？" : "删除会话"}
            <small>{menu.confirmDelete ? "将清空双方的全部消息" : "清空双方消息，不可恢复"}</small>
          </button>
        </div>
      )}

      {activeId !== null
        ? <DmThread key={activeId} conversationId={activeId} />
        : (
          <section className="ws-dm-thread">
            <div className="ws-dm-placeholder">
              <Icon name="message" size={30} />
              <p>选择左侧会话，或发起新的私聊</p>
              <small>仅限同团队成员之间，支持未读提醒与已读回执</small>
            </div>
          </section>
        )}

      {showContacts && (
        <ContactsModal onClose={() => setShowContacts(false)} onPicked={async (userId) => {
          setShowContacts(false);
          await ws.openDmWithPeer(userId);
        }} />
      )}
    </div>
  );
}

// 列表时间：今天显示时分，更早显示月日
function listTime(iso: string): string {
  return dayKey(iso) === dayKey(new Date().toISOString()) ? fmtTime(iso) : fmtDateShort(iso);
}

/* ---------- 右侧消息流 ---------- */

function DmThread({ conversationId }: { conversationId: number }) {
  const ws = useWorkspace();
  const conversation = ws.dmConversations.find((c): c is DmConversation => c.id === conversationId);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dmReply, setDmReply] = useState<{ id: number; content: string; mine: boolean } | null>(null);
  const [olderMessages, setOlderMessages] = useState<DmMessage[] | null>(null);
  const [noMoreOlder, setNoMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("all");
  const [searchAuthor, setSearchAuthor] = useState<number | null>(null);
  const [hits, setHits] = useState<DmHit[] | null>(null);
  const [searchErr, setSearchErr] = useState("");
  const searchReq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const markingRead = useRef(false);
  const loadSeq = useRef(0);

  const partner = conversation?.partner;

  const load = useCallback(() => {
    // 请求序号：过期的轮询响应不得覆盖新状态（例如刚发出的消息）
    const seq = ++loadSeq.current;
    api<{ messages: DmMessage[] }>(`/api/dm/${conversationId}/messages`)
      .then((d) => { if (loadSeq.current === seq) { setMessages(d.messages); setFailed(false); } })
      .catch((e: Error) => { if (loadSeq.current === seq) { setFailed(true); setHint(e.message); } });
  }, [conversationId]);

  // 首次加载 + 轮询（页面切到后台时暂停，避免无谓请求）
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 8000);
    return () => clearInterval(timer);
  }, [load]);

  // 新消息到达时保持贴底；用户上滚查看历史则不动
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // 对方发来的未读消息：进入会话即标记已读，并同步左侧角标
  useEffect(() => {
    if (markingRead.current) return;
    if (!messages.some((m) => !m.mine && !m.readAt)) return;
    markingRead.current = true;
    api(`/api/dm/${conversationId}/read`, { method: "PUT", json: {} })
      .then(() => {
        const now = new Date().toISOString();
        setMessages((items) => items.map((m) => (!m.mine && !m.readAt ? { ...m, readAt: now } : m)));
        void ws.refreshDms();
      })
      .catch(() => { /* 标记失败不打断聊天，下轮轮询重试 */ })
      .finally(() => { markingRead.current = false; });
  }, [messages, conversationId, ws]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setHint("");
    try {
      const d = await api<{ message: DmMessage }>(`/api/dm/${conversationId}/messages`, {
        method: "POST", json: { content, replyToId: dmReply?.id ?? null },
      });
      stickToBottom.current = true;
      loadSeq.current++; // 使在途的旧轮询响应失效，防止把刚发出的消息覆盖掉
      setMessages((items) => [...items, d.message]);
      setText("");
      setDmReply(null);
      void ws.refreshDms().catch(() => {});
    } catch (e) {
      setHint((e as Error).message);
      toast(`发送失败：${(e as Error).message}`, "error");
    } finally {
      setSending(false);
    }
  }

  // 发送文件：与团队聊天同一套限额（≤100MB）与错误提示，成功后本地追加消息卡片
  async function sendFile(file: File) {
    if (uploading) return;
    setUploading(true);
    setHint("");
    try {
      const d = await uploadFile<{ message: DmMessage }>(`/api/dm/${conversationId}/files`, file);
      stickToBottom.current = true;
      loadSeq.current++; // 同上：防止过期轮询响应覆盖刚上传的文件消息
      setMessages((items) => [...items, d.message]);
      void ws.refreshDms().catch(() => {});
      toast(`已发送「${file.name}」`);
    } catch (e) {
      toast(`文件发送失败：${(e as Error).message}`, "error");
    } finally {
      setUploading(false);
    }
  }

  // 聊天记录搜索：300ms 防抖；人名分类需先选会话中的一方；请求序号防过期结果覆盖
  useEffect(() => {
    if (!searchOpen) return;
    if (searchType === "author" && searchAuthor === null) return;
    const req = ++searchReq.current;
    const timer = setTimeout(async () => {
      const query = new URLSearchParams({ type: searchType });
      if (searchQ.trim()) query.set("q", searchQ.trim());
      if (searchType === "author" && searchAuthor) query.set("authorId", String(searchAuthor));
      try {
        const d = await api<{ hits: DmHit[] }>(`/api/dm/${conversationId}/messages/search?${query}`);
        if (searchReq.current === req) { setHits(d.hits); setSearchErr(""); }
      } catch (e) {
        if (searchReq.current === req) setSearchErr((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQ, searchType, searchAuthor, conversationId]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQ("");
    setSearchType("all");
    setSearchAuthor(null);
    setHits(null);
    setSearchErr("");
  }

  // 展示的消息 = 本地翻页前缀 + 窗口；翻页后轮询刷新仍保留更早历史
  const allMessages = olderMessages
    ? [...olderMessages, ...messages.filter((m) => !olderMessages.some((o) => o.id === m.id))]
    : messages;

  // 定位并高亮一条消息（搜索跳转）；DOM 提交有延迟，轻量重试
  function flashMessage(id: number, tries = 0) {
    const el = document.getElementById(`dm-m-${id}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("ws-flash");
      setTimeout(() => el.classList.remove("ws-flash"), 1700);
    } else if (tries < 12) {
      setTimeout(() => flashMessage(id, tries + 1), 60);
    }
  }

  // 跳转到任意历史消息：已加载直接定位，否则向前翻页（最多 10 页）
  async function jumpTo(id: number) {
    closeSearch();
    if (allMessages.some((m) => m.id === id)) { flashMessage(id); return; }
    let cursor = allMessages[0]?.id ?? id + 1;
    for (let i = 0; i < 10; i++) {
      try {
        const d = await api<{ messages: DmMessage[] }>(`/api/dm/${conversationId}/messages?beforeId=${cursor}`);
        if (d.messages.length === 0) { setNoMoreOlder(true); toast("该消息已无法加载"); return; }
        // 函数式更新：循环内不能引用过期的 olderMessages，否则逐页跳转时会覆盖掉已加载的页
        setOlderMessages((prev) => {
          const older = prev ?? [];
          const seen = new Set(older.map((o) => o.id));
          return [...d.messages.filter((m) => !seen.has(m.id)), ...older];
        });
        if (d.messages.length < 80) setNoMoreOlder(true);
        if (d.messages.some((m) => m.id === id)) { flashMessage(id); return; }
        if (d.messages.length < 80) { toast("已加载全部历史，未找到该消息"); return; }
        cursor = d.messages[0].id;
      } catch (e) {
        toast((e as Error).message, "error");
        return;
      }
    }
    toast("历史记录过多，请缩小搜索范围");
  }

  // 加载更早的消息（保持阅读位置）
  async function loadOlder() {
    const first = allMessages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const d = await api<{ messages: DmMessage[] }>(`/api/dm/${conversationId}/messages?beforeId=${first.id}`);
      if (d.messages.length === 0) { setNoMoreOlder(true); return; }
      if (d.messages.length < 80) setNoMoreOlder(true);
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const prevTop = el?.scrollTop ?? 0;
      setOlderMessages(olderMessages ? [...d.messages, ...olderMessages] : d.messages);
      setTimeout(() => {
        const el2 = scrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevHeight + prevTop;
      }, 60);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function recallMessage(id: number) {
    try {
      await api(`/api/dm/${conversationId}/messages/${id}/recall`, { method: "POST", json: {} });
      load();
      toast("已撤回");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  // 撤回窗口计时（避免渲染中直接调用 Date.now）
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // 我发出的最后一条消息：展示已读回执（日期分隔用相邻比较，不在渲染中改写变量）
  const lastMineId = [...allMessages].reverse().find((m) => m.mine)?.id ?? null;

  return (
    <section className="ws-dm-thread" aria-label="私信消息">
      <div className="ws-dm-thread-head">
        {partner && (
          <>
            <span className="ws-avatar-pos">
              <Avatar name={partner.displayName} colorKey={partner.userId} />
              <i className={`ws-online-dot ${partner.online ? "on" : ""}`} />
            </span>
            <b>{partner.displayName}</b>
            <span className={`ws-online-text ${partner.online ? "on" : ""}`}>{partner.online ? "在线" : "离线"}</span>
          </>
        )}
        <button className="ws-icon-btn" style={{ marginLeft: "auto" }} title="搜索聊天记录" aria-label="搜索聊天记录"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
          <Icon name="search" size={14} />
        </button>
      </div>

      {searchOpen && (
        <div className="ws-chat-search">
          <div className="ws-chat-search-row">
            <div className="ws-search" style={{ margin: 0, flex: 1 }}>
              <Icon name="search" size={13} />
              <input placeholder="搜索聊天记录…（原文 / 文件名 / 对方名）" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
            </div>
          </div>
          <div className="ws-chat-search-row" role="group" aria-label="搜索分类">
            {SEARCH_TABS.map(([value, label]) => (
              <button key={value} className={`ws-filter-chip ${searchType === value ? "active" : ""}`}
                onClick={() => { setSearchType(value); if (value !== "author") setSearchAuthor(null); }}>
                {label}
              </button>
            ))}
          </div>
          {searchType === "author" && (
            <div className="ws-chat-search-row" role="group" aria-label="选择成员">
              <button className={`ws-filter-chip ${searchAuthor === ws.me.id ? "active" : ""}`} onClick={() => setSearchAuthor(searchAuthor === ws.me.id ? null : ws.me.id)}>我</button>
              {partner && (
                <button className={`ws-filter-chip ${searchAuthor === partner.userId ? "active" : ""}`} onClick={() => setSearchAuthor(searchAuthor === partner.userId ? null : partner.userId)}>
                  <Avatar name={partner.displayName} colorKey={partner.userId} size="sm" />{partner.displayName}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div
        className="ws-dm-scroll"
        ref={searchOpen ? undefined : scrollRef}
        onScroll={searchOpen ? undefined : (e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {searchOpen ? (
          <>
            {searchErr && <div className="ws-error" role="alert" style={{ margin: 12 }}>{searchErr}</div>}
            {!searchErr && searchType === "author" && searchAuthor === null && <div className="ws-empty" style={{ margin: "20px 16px" }}>先选择要查找的成员</div>}
            {!searchErr && !(searchType === "author" && searchAuthor === null) && hits === null && <div className="ws-empty" style={{ margin: "20px 16px" }}>输入关键词开始搜索…</div>}
            {!searchErr && !(searchType === "author" && searchAuthor === null) && hits?.length === 0 && <div className="ws-empty" style={{ margin: "20px 16px" }}>没有找到匹配的聊天记录</div>}
            {!searchErr && !(searchType === "author" && searchAuthor === null) && hits?.map((hit) => (
              <div key={hit.id} className="ws-hit ws-hit-jump" title="点击定位到原消息" onClick={() => void jumpTo(hit.id)}>
                <Avatar name={hit.senderName} colorKey={hit.senderId} />
                <div className="ws-hit-main">
                  <div className="ws-hit-head"><b>{hit.mine ? "我" : hit.senderName}</b><span>{fmtDateShort(hit.createdAt)} {fmtTime(hit.createdAt)}</span></div>
                  {hit.attachment ? (
                    <a className="ws-dm-file" href={`/api/dm/files/${hit.attachment.id}`} title="点击下载" onClick={(e) => e.stopPropagation()}>
                      <span className="ws-dm-file-ic"><Icon name="file" size={16} /></span>
                      <span className="ws-dm-file-main"><b>{hit.attachment.name}</b><small>{fmtSize(hit.attachment.size)} · 点击下载</small></span>
                      <Icon name="download" size={14} />
                    </a>
                  ) : (
                    <div className="ws-hit-content">{hit.content}</div>
                  )}
                </div>
              </div>
            ))}
          </>
        ) : (<>
          {failed && <div className="ws-error" role="alert" style={{ margin: 12 }}>消息加载失败：{hint}<button className="ws-btn" style={{ marginLeft: 10 }} onClick={load}>重试</button></div>}
          {!noMoreOlder && allMessages.length > 0 && (
            <button className="ws-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "加载中…" : "加载更早的消息"}
            </button>
          )}
          {noMoreOlder && allMessages.length > 0 && <div className="ws-load-older done">已加载全部历史</div>}
          {!failed && allMessages.length === 0 && (
            <div className="ws-empty" style={{ margin: "24px 16px" }}>向 {partner?.displayName ?? "对方"} 打个招呼吧 👋</div>
          )}
          {allMessages.map((m, i) => {
            const day = dayKey(m.createdAt);
            const showSep = i === 0 || dayKey(allMessages[i - 1].createdAt) !== day;
            const canRecall = m.mine && !m.recalled
              && nowTick - new Date(m.createdAt).getTime() < 2 * 60 * 1000;
            return (
              <div key={m.id} id={`dm-m-${m.id}`}>
                {showSep && <div className="ws-date-sep"><span>{fmtDateShort(m.createdAt)}</span></div>}
                {m.recalled ? (
                  <div className={`ws-dm-msg ${m.mine ? "mine" : ""}`}>
                    <div className="ws-recalled">{m.mine ? "你" : partner?.displayName ?? "对方"} 撤回了一条消息</div>
                  </div>
                ) : (
                  <div className="ws-dm-msgwrap">
                    <div className={`ws-dm-msg ${m.mine ? "mine" : ""}`}>
                      <div className="ws-dm-msgcol">
                        {m.replyTo && (
                          <div className="ws-dm-quote">回复 {m.replyTo.mine ? "我" : partner?.displayName ?? "对方"}：{m.replyTo.content}</div>
                        )}
                        {m.attachment ? (
                        <a className="ws-dm-file" href={`/api/dm/files/${m.attachment.id}`} title="点击下载">
                          <span className="ws-dm-file-ic"><Icon name="file" size={16} /></span>
                          <span className="ws-dm-file-main">
                            <b>{m.attachment.name}</b>
                            <small>{fmtSize(m.attachment.size)} · 点击下载</small>
                          </span>
                          <Icon name="download" size={14} />
                        </a>
                      ) : (
                        <div className="ws-dm-bubble">{m.content}</div>
                      )}
                      </div>
                    </div>
                    <div className="ws-dm-quick">
                      <button title="引用回复" onClick={() => { setDmReply({ id: m.id, content: (m.attachment?.name ?? m.content).slice(0, 40), mine: m.mine }); inputRef.current?.focus(); }}>回复</button>
                      {canRecall && <button title="撤回（2 分钟内）" onClick={() => void recallMessage(m.id)}>撤回</button>}
                    </div>
                  </div>
                )}
                {m.id === lastMineId && !m.recalled && (
                  <div className={`ws-dm-receipt ${m.mine ? "mine" : ""}`}>{m.readAt ? "已读" : "未读"}</div>
                )}
              </div>
            );
          })}
        </>)}
      </div>

      <div className="ws-dm-input">
        {dmReply && (
          <div className="ws-reply-banner">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              回复 {dmReply.mine ? "我" : partner?.displayName ?? "对方"}：{dmReply.content}
            </span>
            <button className="ws-icon-btn" style={{ width: 20, height: 20 }} onClick={() => setDmReply(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
        {hint && !failed && <div className="ws-error" style={{ marginTop: 0, marginBottom: 6 }}>{hint}</div>}
        {showEmoji && (
          <div className="ws-member-pick" style={{ width: "auto", display: "flex", gap: 2, left: 34 }}>
            {EMOJIS.map((e) => (
              <button key={e} style={{ width: 34, fontSize: 15 }} onClick={() => { setText((t) => t + e); setShowEmoji(false); inputRef.current?.focus(); }}>
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="ws-input-row">
          <div className="ws-input-tools">
            <button className="ws-tool-btn" title={uploading ? "正在发送…" : "发送文件（≤100MB）"} disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={15} />
            </button>
            <button className="ws-tool-btn" title="表情" onClick={() => setShowEmoji((v) => !v)}>
              <Icon name="smile" size={15} />
            </button>
          </div>
          <textarea
            ref={inputRef}
            className="ws-chat-textarea"
            rows={1}
            placeholder={partner ? `发私信给 ${partner.displayName}…（Enter 发送）` : "发消息…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // isComposing：输入法选词回车不发送
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="ws-send" disabled={!text.trim() || sending} onClick={() => void send()}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void sendFile(file);
          }}
        />
      </div>
    </section>
  );
}

/* ---------- 发起私聊：同团队联系人选择 ---------- */

function ContactsModal({ onClose, onPicked }: { onClose(): void; onPicked(userId: number): void | Promise<void> }) {
  const [contacts, setContacts] = useState<DmContact[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api<{ contacts: DmContact[] }>("/api/dm/contacts")
      .then((d) => { if (active) setContacts(d.contacts); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  const filtered = (contacts ?? []).filter((c) => c.displayName.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal title="发起私聊" onClose={onClose}>
      <div className="ws-field">
        <label htmlFor="dm-contact-search">搜索成员（仅同团队）</label>
        <input
          id="dm-contact-search"
          className="ws-input"
          placeholder="输入展示名筛选…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <div className="ws-error" role="alert">{error}</div>}
      {!contacts && !error && <div className="ws-empty">正在加载联系人…</div>}
      {contacts && filtered.length === 0 && (
        <div className="ws-empty">没有匹配的成员。先加入或创建团队，才能与成员私聊。</div>
      )}
      <div className="ws-dm-contacts">
        {filtered.map((c) => (
          <button
            key={c.userId}
            disabled={busyId !== null}
            onClick={() => { setBusyId(c.userId); void Promise.resolve(onPicked(c.userId)).catch((e: Error) => { setError(e.message); setBusyId(null); }); }}
          >
            <span className="ws-avatar-pos">
              <Avatar name={c.displayName} colorKey={c.userId} size="sm" />
              <i className={`ws-online-dot ${c.online ? "on" : ""}`} />
            </span>
            <span className="ws-dm-contact-name">{c.displayName}</span>
            <small className="ws-online-text">{c.online ? "在线" : "离线"}{c.teamName ? ` · ${c.teamName}${c.teamCount > 1 ? ` 等 ${c.teamCount} 个团队` : ""}` : ""}</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}
