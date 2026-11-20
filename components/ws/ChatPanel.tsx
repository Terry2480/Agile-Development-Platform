"use client";

// 团队聊天面板（消息体验增强）：
// 置顶公告（可多条+公告列表）、多表情回应、引用回复、消息撤回（2 分钟）、文件消息、
// 聊天记录搜索（分类）+ 结果跳转上下文高亮、加载更早消息、今日要点摘要
import { useEffect, useRef, useState } from "react";
import { api, STATUS_TEXT, dayKey, fmtDateShort, fmtSize, fmtTime, type ChatMessage } from "@/lib/api-client";
import { useWorkspace, Icon, Avatar, Modal } from "./shared";
import { renderMentions } from "./helpers";
import { toast } from "@/lib/toast";

const EMOJIS = ["👍", "🎉", "😂", "🙏", "💪", "👀", "❤️", "🔥"];
const REACTIONS = ["👍", "🎉", "😂", "🙏", "💪", "❤️"];
const RECALL_WINDOW_MS = 2 * 60 * 1000;

type ChatHit = {
  id: number;
  content: string;
  createdAt: string;
  author: { id: number; displayName: string };
  attachment: { id: number; name: string; size: number } | null;
};
type SearchType = "all" | "text" | "link" | "file" | "author";
const SEARCH_TABS: [SearchType, string][] = [["all", "全部"], ["text", "原文"], ["link", "链接"], ["file", "文件"], ["author", "人名"]];
type ChatSummaryView = { date: string; summary: { messageCount: number; participants: string[]; tasks: string[]; files: string[]; links: string[]; openQuestions: number } };

export function ChatPanel() {
  const ws = useWorkspace();
  const project = ws.projects.find((p) => p.id === ws.selectedId);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; authorName: string; content: string } | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("all");
  const [searchAuthor, setSearchAuthor] = useState<number | null>(null);
  const [hits, setHits] = useState<ChatHit[] | null>(null);
  const [searchErr, setSearchErr] = useState("");
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedList, setPinnedList] = useState<ChatMessage[] | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState<ChatSummaryView | null>(null);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[] | null>(null);
  const [noMoreOlder, setNoMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const searchReq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 展示的消息 = 本地翻页前缀 + store 最新窗口；轮询刷新时窗口仍来自 store，前缀保留
  const storeMessages = ws.chat;
  const messages = olderMessages
    ? [...olderMessages, ...storeMessages.filter((m) => !olderMessages.some((o) => o.id === m.id))]
    : storeMessages;
  const pinned = messages.filter((m) => m.pinned && !m.recalled);
  const latestPinned = pinned[pinned.length - 1] ?? null;
  const memberNames = ws.detail?.members.map((m) => m.displayName) ?? [];
  const projectId = project?.id ?? null;

  // 新消息自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [storeMessages.length, project?.id]);

  // 切换项目时清空输入与翻页状态（渲染期对齐，避免级联 effect）
  const [seenProject, setSeenProject] = useState<number | null>(project?.id ?? null);
  if ((project?.id ?? null) !== seenProject) {
    setSeenProject(project?.id ?? null);
    setText("");
    setReplyTo(null);
    setHint("");
    setNoMoreOlder(false);
    setOlderMessages(null);
  }

  // 撤回窗口计时（避免渲染中直接调用 Date.now）
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // 聊天记录搜索：300ms 防抖；人名分类需先选成员；请求序号防过期结果覆盖
  useEffect(() => {
    if (!searchOpen || !projectId) return;
    if (searchType === "author" && searchAuthor === null) return;
    const req = ++searchReq.current;
    const timer = setTimeout(async () => {
      const query = new URLSearchParams({ type: searchType });
      if (searchQ.trim()) query.set("q", searchQ.trim());
      if (searchType === "author" && searchAuthor) query.set("authorId", String(searchAuthor));
      try {
        const d = await api<{ hits: ChatHit[] }>(`/api/projects/${projectId}/chat/search?${query}`);
        if (searchReq.current === req) { setHits(d.hits); setSearchErr(""); }
      } catch (e) {
        if (searchReq.current === req) setSearchErr((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQ, searchType, searchAuthor, projectId]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQ("");
    setSearchType("all");
    setSearchAuthor(null);
    setHits(null);
    setSearchErr("");
  }

  // 定位并高亮一条消息（搜索跳转）；DOM 提交有延迟，轻量重试
  function flashMessage(id: number, tries = 0) {
    const el = document.getElementById(`chat-m-${id}`);
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
    if (messages.some((m) => m.id === id)) { flashMessage(id); return; }
    let cursor = messages[0]?.id ?? id + 1;
    for (let i = 0; i < 10; i++) {
      try {
        const d = await api<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat?beforeId=${cursor}`);
        if (d.messages.length === 0) { setNoMoreOlder(true); toast("该消息已无法加载"); return; }
        const prefix = olderMessages ? [...d.messages, ...olderMessages.filter((o) => !d.messages.some((n) => n.id === o.id))] : d.messages;
        setOlderMessages(prefix);
        if (d.messages.length < 50) setNoMoreOlder(true);
        if (d.messages.some((m) => m.id === id)) { flashMessage(id); return; }
        if (d.messages.length < 50) { toast("已加载全部历史，未找到该消息"); return; }
        cursor = d.messages[0].id;
      } catch (e) {
        toast((e as Error).message, "error");
        return;
      }
    }
    toast("历史记录过多，请缩小搜索范围");
  }

  // 加载更早的消息（保持阅读位置不跳动）
  async function loadOlder() {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const d = await api<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat?beforeId=${first.id}`);
      if (d.messages.length === 0) { setNoMoreOlder(true); return; }
      if (d.messages.length < 50) setNoMoreOlder(true);
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

  async function openPinnedList() {
    setPinnedOpen(true);
    setPinnedList(null);
    try {
      const d = await api<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat?pinned=1`);
      setPinnedList(d.messages);
    } catch (e) {
      setPinnedList([]);
      toast((e as Error).message, "error");
    }
  }

  async function openSummary() {
    setSummaryOpen(true);
    setSummary(null);
    try {
      setSummary(await api<ChatSummaryView>(`/api/projects/${projectId}/chat/summary`));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function recallMessage(id: number) {
    try {
      await api(`/api/chat/${id}/recall`, { method: "POST", json: {} });
      await ws.refreshChat();
      toast("已撤回");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!project) {
    return (
      <aside className="ws-chat">
        <div className="ws-chat-head"><b>团队聊天</b></div>
        <div className="ws-empty" style={{ margin: 16 }}>选择项目后开始群聊</div>
      </aside>
    );
  }

  async function send() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await ws.sendChat(content, { replyToId: replyTo?.id });
      setText("");
      setReplyTo(null);
    } catch (e) {
      setHint((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function insertMention(name: string) {
    setText((t) => `${t}@${name} `);
    setShowMembers(false);
    inputRef.current?.focus();
  }

  return (
    <aside className="ws-chat">
      <div className="ws-chat-head">
        <Icon name="message" size={15} />
        <b>#{project.name}</b>
        <span>· {ws.detail?.members.length ?? project.members.length} 位成员</span>
        <button className="ws-icon-btn" style={{ marginLeft: "auto" }} title="今日要点" aria-label="今日要点" onClick={() => void openSummary()}>
          <Icon name="list" size={14} />
        </button>
        <button className="ws-icon-btn" title="搜索聊天记录" aria-label="搜索聊天记录"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
          <Icon name="search" size={14} />
        </button>
      </div>

      {searchOpen && (
        <div className="ws-chat-search">
          <div className="ws-chat-search-row">
            <div className="ws-search" style={{ margin: 0, flex: 1 }}>
              <Icon name="search" size={13} />
              <input placeholder="搜索聊天记录…（原文 / 文件名 / 成员名）" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
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
              {ws.detail?.members.map((m) => (
                <button key={m.userId} className={`ws-filter-chip ${searchAuthor === m.userId ? "active" : ""}`}
                  onClick={() => setSearchAuthor(searchAuthor === m.userId ? null : m.userId)}>
                  <Avatar name={m.displayName} colorKey={m.userId} size="sm" />{m.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!searchOpen && latestPinned && (
        <button className="ws-pinned" title="查看全部公告" onClick={() => void openPinnedList()}>
          <span className="pin-ic"><Icon name="pin" size={13} /></span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
            <b>{latestPinned.author.displayName}：</b>{latestPinned.content.slice(0, 60)}
          </span>
          {pinned.length > 1 && <span className="ws-pinned-count">共 {pinned.length} 条</span>}
        </button>
      )}

      {searchOpen ? (
        <div className="ws-chat-scroll">
          {searchErr && <div className="ws-error" role="alert" style={{ margin: 12 }}>{searchErr}</div>}
          {!searchErr && searchType === "author" && searchAuthor === null && <div className="ws-empty" style={{ margin: "20px 4px" }}>先选择要查找的成员</div>}
          {!searchErr && !(searchType === "author" && searchAuthor === null) && hits === null && <div className="ws-empty" style={{ margin: "20px 4px" }}>输入关键词开始搜索…</div>}
          {!searchErr && !(searchType === "author" && searchAuthor === null) && hits?.length === 0 && <div className="ws-empty" style={{ margin: "20px 4px" }}>没有找到匹配的聊天记录</div>}
          {!searchErr && !(searchType === "author" && searchAuthor === null) && hits?.map((hit) => (
            <div key={hit.id} className="ws-hit ws-hit-jump" title="点击定位到原消息" onClick={() => void jumpTo(hit.id)}>
              <Avatar name={hit.author.displayName} colorKey={hit.author.id} />
              <div className="ws-hit-main">
                <div className="ws-hit-head"><b>{hit.author.displayName}</b><span>{fmtDateShort(hit.createdAt)} {fmtTime(hit.createdAt)}</span></div>
                {hit.attachment ? (
                  <a className="ws-dm-file" href={`/api/files/${hit.attachment.id}`} title="点击下载" onClick={(e) => e.stopPropagation()}>
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
        </div>
      ) : (
        <div className="ws-chat-scroll" ref={scrollRef}>
          {!noMoreOlder && messages.length > 0 && (
            <button className="ws-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "加载中…" : "加载更早的消息"}
            </button>
          )}
          {noMoreOlder && messages.length > 0 && <div className="ws-load-older done">已加载全部历史</div>}
          {messages.length === 0 && (
            <div className="ws-empty" style={{ margin: "20px 4px" }}>还没有消息，打个招呼吧 👋</div>
          )}
          {messages.map((m, i) => {
            const day = dayKey(m.createdAt);
            const showSep = i === 0 || dayKey(messages[i - 1].createdAt) !== day;
            const canRecall = m.author.id === ws.me.id && !m.recalled
              && nowTick - new Date(m.createdAt).getTime() < RECALL_WINDOW_MS;
            const thumbsUp = m.reactions.find((r) => r.emoji === "👍");
            return (
              <div key={m.id} id={`chat-m-${m.id}`}>
                {showSep && (
                  <div className="ws-date-sep"><span>{fmtDateShort(m.createdAt)}</span></div>
                )}
                <div className="ws-msg">
                  <Avatar name={m.author.displayName} colorKey={m.author.id} />
                  <div className="ws-msg-body">
                    <div className="ws-msg-head"><b>{m.author.displayName}</b><span>{fmtTime(m.createdAt)}</span></div>
                    {m.recalled ? (
                      <div className="ws-recalled">{m.author.displayName} 撤回了一条消息</div>
                    ) : (<>
                      {m.replyTo && (
                        <div className="ws-msg-reply">回复 {m.replyTo.authorName}：{m.replyTo.content}</div>
                      )}
                      {m.attachment ? (
                        <a className="ws-dm-file" href={`/api/files/${m.attachment.id}`} title="点击下载">
                          <span className="ws-dm-file-ic"><Icon name="file" size={16} /></span>
                          <span className="ws-dm-file-main"><b>{m.attachment.name}</b><small>{fmtSize(m.attachment.size)} · 点击下载</small></span>
                          <Icon name="download" size={14} />
                        </a>
                      ) : (
                        <div className="ws-msg-content">{renderMentions(m.content, memberNames)}</div>
                      )}
                      {m.task && (
                        <div className="ws-task-link" onClick={() => ws.openTask(m.task!.id)}>
                          <span className="t-code">{m.task.code}</span>
                          <span className="t-title">{m.task.title}</span>
                          <span className={`ws-pill st-${m.task.status}`}>{STATUS_TEXT[m.task.status]}</span>
                        </div>
                      )}
                      {m.reactions.length > 0 && (
                        <div className="ws-reactions">
                          {m.reactions.map((r) => (
                            <button key={r.emoji} className={`ws-reaction ${r.mine ? "mine" : ""}`}
                              title={r.mine ? "取消回应" : "回应"} onClick={() => ws.toggleLike(m.id, r.emoji)}>
                              {r.emoji}{r.count > 1 ? ` ${r.count}` : ""}
                            </button>
                          ))}
                        </div>
                      )}
                      {pickFor === m.id && (
                        <div className="ws-react-pick" role="menu" aria-label="选择表情">
                          {REACTIONS.map((e) => (
                            <button key={e} onClick={() => { setPickFor(null); ws.toggleLike(m.id, e); }}>{e}</button>
                          ))}
                        </div>
                      )}
                      <div className="ws-msg-actions">
                        <button className={thumbsUp?.mine ? "liked" : ""} aria-label="赞同" title="赞同" onClick={() => ws.toggleLike(m.id, "👍")}>
                          <span aria-hidden="true">👍</span>{thumbsUp && thumbsUp.count > 0 ? ` ${thumbsUp.count}` : ""}
                        </button>
                        <button title="更多表情回应" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}>😊 回应</button>
                        <button onClick={() => { setReplyTo({ id: m.id, authorName: m.author.displayName, content: (m.attachment?.name ?? m.content).slice(0, 40) }); inputRef.current?.focus(); }}>
                          回复
                        </button>
                        {canRecall && <button onClick={() => void recallMessage(m.id)}>撤回</button>}
                        {ws.detail && (ws.detail.myRole === "owner" || ws.detail.myRole === "admin") && (
                          <button onClick={() => ws.togglePin(m.id, !m.pinned)} title={m.pinned ? "取消置顶" : "置顶为公告"}>
                            {m.pinned ? "取消置顶" : "置顶"}
                          </button>
                        )}
                      </div>
                    </>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ws-chat-input">
        {replyTo && (
          <div className="ws-reply-banner">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              回复 {replyTo.authorName}：{replyTo.content}
            </span>
            <button className="ws-icon-btn" style={{ width: 20, height: 20 }} onClick={() => setReplyTo(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
        {hint && <div className="ws-error" style={{ marginTop: 0, marginBottom: 6 }}>{hint}</div>}

        {showMembers && (
          <div className="ws-member-pick">
            {ws.detail?.members.map((m) => (
              <button key={m.userId} onClick={() => insertMention(m.displayName)}>
                <Avatar name={m.displayName} colorKey={m.userId} size="sm" />
                {m.displayName}
              </button>
            ))}
          </div>
        )}
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
            <button className="ws-tool-btn" title="发送文件到聊天（同时存入项目文件库）" onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={15} />
            </button>
            <button className="ws-tool-btn" title="提及成员" onClick={() => { setShowEmoji(false); setShowMembers((v) => !v); }}>
              <Icon name="at" size={15} />
            </button>
            <button className="ws-tool-btn" title="表情" onClick={() => { setShowMembers(false); setShowEmoji((v) => !v); }}>
              <Icon name="smile" size={15} />
            </button>
          </div>
          <textarea
            ref={inputRef}
            className="ws-chat-textarea"
            rows={1}
            placeholder={`发消息到 #${project.name}…（Enter 发送）`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="ws-send" disabled={!text.trim() || busy} onClick={send}>发送</button>
        </div>

        <input
          ref={fileRef} type="file" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              setHint("");
              const name = await ws.uploadProjectFile(file);
              await ws.refreshChat();
              toast(`已发送「${name}」`);
            } catch (err) {
              toast(`文件发送失败：${(err as Error).message}`, "error");
            }
          }}
        />
      </div>

      {pinnedOpen && (
        <Modal title="频道公告" onClose={() => setPinnedOpen(false)}>
          {pinnedList === null && <div className="ws-empty">正在加载公告…</div>}
          {pinnedList?.length === 0 && <div className="ws-empty">暂无公告</div>}
          <div className="ws-pin-list">
            {pinnedList?.map((p) => (
              <div key={p.id} className="ws-pin-item">
                <div className="ws-pin-main">
                  <div className="ws-hit-head"><b>{p.author.displayName}</b><span>{fmtDateShort(p.createdAt)} {fmtTime(p.createdAt)}</span></div>
                  <div className="ws-hit-content">{p.attachment ? `《${p.attachment.name}》` : p.content}</div>
                </div>
                {ws.detail && (ws.detail.myRole === "owner" || ws.detail.myRole === "admin") && (
                  <button className="ws-btn" style={{ padding: "5px 10px", fontSize: 12, flexShrink: 0 }}
                    onClick={() => { void ws.togglePin(p.id, false).then(() => openPinnedList()); }}>取消置顶</button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {summaryOpen && (
        <Modal title="今日要点" onClose={() => setSummaryOpen(false)}>
          {summary === null && <div className="ws-empty">正在生成要点…</div>}
          {summary && (
            <div className="ws-sum">
              <p className="ws-sum-line">{summary.date} · {summary.summary.messageCount} 条消息 · {summary.summary.participants.length} 人参与（{summary.summary.participants.join("、") || "—"}）</p>
              {summary.summary.tasks.length > 0 && (
                <p className="ws-sum-line"><b>提及任务：</b>{summary.summary.tasks.map((t) => <span key={t} className="ws-doc-chip" style={{ marginRight: 6 }}>{t}</span>)}</p>
              )}
              {summary.summary.files.length > 0 && (
                <p className="ws-sum-line"><b>发送文件：</b>{summary.summary.files.join("、")}</p>
              )}
              {summary.summary.links.length > 0 && (
                <p className="ws-sum-line"><b>分享链接：</b>{summary.summary.links.map((l, i) => <a key={i} href={l} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>{l}</a>)}</p>
              )}
              <p className="ws-sum-line"><b>待跟进问题：</b>{summary.summary.openQuestions} 条{summary.summary.openQuestions > 0 ? "，记得回复" : ""}</p>
              {summary.summary.messageCount === 0 && <div className="ws-empty">今天还没有消息</div>}
            </div>
          )}
        </Modal>
      )}
    </aside>
  );
}
