import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Loader2, MoveDiagonal, Quote as QuoteIcon, Search, Send, X } from "lucide-react";
import { Markdown } from "@/components/chat/Markdown";
import { openExploreCard, resetExploreCard, sendBranchMessage, startExploreCard, switchExploreMode } from "@/lib/explore";
import type { ChatTerm, ExploreMode } from "@/lib/api";
import { useAppStore, type ExploreCardState } from "@/stores/app";
import { cn } from "@/lib/utils";

const MODE_META: Record<ExploreMode, { label: string; short: string; icon: string; badge: string; placeholder: string }> = {
  child: { label: "子卡片 · 深挖背景", short: "深挖", icon: "↗️", badge: "bg-island-sky/15 text-island-sky", placeholder: "想深挖哪部分？例如：它的前置知识 / 原理细节…（留空则默认讲解）" },
  related: { label: "关联卡片 · 横向对比", short: "对比", icon: "➡️", badge: "bg-island-coral/15 text-island-coral", placeholder: "想对比哪些方面？例如：它和 XX 有什么区别…（留空则默认发散对比）" },
  branch: { label: "分支卡片 · 继承上下文", short: "分支", icon: "⬇️", badge: "bg-island-lavender/15 text-island-lavender", placeholder: "想从分支聊什么？留空则默认讲解该名词…" },
};

const MODE_ORDER: ExploreMode[] = ["child", "related", "branch"];

function initialSize() {
  return {
    w: Math.min(400, window.innerWidth - 32),
    h: Math.min(640, window.innerHeight - 128),
  };
}

export function ExploreCard({
  card,
  depth,
  breadcrumb,
}: {
  card: ExploreCardState;
  depth: number;
  breadcrumb: string[];
}) {
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string; bubbleText: string } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState(initialSize);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number; originDragX: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const exploreClose = useAppStore((s) => s.exploreClose);
  const meta = MODE_META[card.mode];
  const isPending = card.status === "pending";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [card.messages]);

  // —— 移动（header 拖动）：卡片以 right 锚定，水平偏移取反，保证跟随鼠标 ——
  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: dragOffset.x, originY: dragOffset.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    setDragOffset({
      x: dragRef.current.originX - (event.clientX - dragRef.current.startX),
      y: dragRef.current.originY + (event.clientY - dragRef.current.startY),
    });
  }
  function endDrag() {
    dragRef.current = null;
  }

  // —— 缩放（右下角拖拽）：反向补偿 right 偏移，固定左上角、右下角跟随鼠标 ——
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, startY: event.clientY, originW: size.w, originH: size.h, originDragX: dragOffset.x };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!resizeRef.current) return;
    const nextW = Math.max(300, Math.min(resizeRef.current.originW + (event.clientX - resizeRef.current.startX), Math.min(560, window.innerWidth - 16)));
    const nextH = Math.max(240, Math.min(resizeRef.current.originH + (event.clientY - resizeRef.current.startY), window.innerHeight - 64));
    const nextX = resizeRef.current.originDragX - (nextW - resizeRef.current.originW);
    setSize({ w: nextW, h: nextH });
    setDragOffset((prev) => ({ ...prev, x: nextX }));
  }
  function endResize() {
    resizeRef.current = null;
  }

  // —— 卡片内选中文本 → 「追问 / 引用」操作条 ——
  function handleSelection(event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest("button")) {
      setQuoteBtn(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setQuoteBtn(null);
      return;
    }
    let node: Node | null = selection.anchorNode;
    while (node && !(node instanceof HTMLElement && node.dataset.bubble === "assistant")) {
      node = node.parentNode;
    }
    if (!node) {
      setQuoteBtn(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setQuoteBtn({
      x: rect.left + rect.width / 2,
      y: rect.top - 36,
      text: selection.toString().trim().slice(0, 300),
      bubbleText: (node as HTMLElement).textContent?.slice(0, 4000) ?? "",
    });
  }

  /** 下钻一张新卡片（术语点击 / 选中文本追问），上下文沿卡片链累积。 */
  function drill(termText: string, explanation: string | undefined, messageContent: string) {
    openExploreCard({
      term: termText.slice(0, 40),
      explanation,
      context: [card.context, messageContent].filter(Boolean).join("\n\n").slice(0, 8000),
      mode: "child",
      conversationId: card.branchConversationId ?? card.conversationId,
      sourceMessageId: card.sourceMessageId,
      parentCardId: card.cardId,
      parentKey: card.key,
      modelId: card.modelId,
    });
  }

  // —— 发送：pending / child / related → 生成（或重新生成）；branch → 分支内追加 ——
  async function send() {
    if (card.status === "streaming") return;
    const question = input.trim();
    const fullQuestion = quote ? `引用内容：\n${quote}\n\n${question}` : question;
    setInput("");
    setQuote(null);
    if (card.mode === "branch" && !isPending) {
      await sendBranchMessage(card.key, fullQuestion);
    } else {
      await startExploreCard(card.key, fullQuestion);
    }
  }

  /** 渲染消息列表（pending 态展示切换前的旧回答时复用）。 */
  function renderMessages(msgs: ExploreCardState["messages"]) {
    return (
      <div className="space-y-3">
        {msgs.map((message, index) => (
          <div key={index} className={cn("flex gap-2", message.role === "user" ? "justify-end" : "")}>
            <div
              className={cn(
                "max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-soft",
                message.role === "user" ? "rounded-br-md bg-claude-user" : "rounded-bl-md border bg-white"
              )}
            >
              {message.role === "assistant" ? (
                message.content ? (
                  <div data-bubble="assistant">
                    <Markdown terms={message.terms} onTermClick={(term) => drill(term.text, term.explanation, message.content)}>
                      {message.content}
                    </Markdown>
                  </div>
                ) : (
                  <span className="text-claude-muted">…</span>
                )
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              )}
              {message.streaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse align-middle bg-claude-accent" />}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <aside
      style={{
        right: `${16 + depth * 24 + dragOffset.x}px`,
        top: `${84 + depth * 26 + dragOffset.y}px`,
        width: size.w,
        height: size.h,
        zIndex: 40 + depth,
      }}
      className={cn(
        "fixed flex flex-col overflow-hidden rounded-[1.5rem] border border-white bg-[#f8fcfb] shadow-island",
        card.closing ? "explore-card-out" : "explore-card-in"
      )}
    >
      <header
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-move select-none items-center justify-between border-b border-claude-border/70 bg-white/90 px-4 py-3 backdrop-blur"
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical size={15} className="shrink-0 text-claude-muted/70" />
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", meta.badge)}>
            <span className="text-sm leading-none">{meta.icon}</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-claude-ink">{card.term}</div>
            <div className="truncate text-[10px] text-claude-muted">{meta.label}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => exploreClose(card.key)}
          className="rounded-full p-1.5 text-claude-muted hover:bg-claude-panel hover:text-claude-ink"
          title="关闭卡片"
        >
          <X size={16} />
        </button>
      </header>

      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-claude-border/50 bg-white/50 px-4 py-1.5 text-[10px] font-bold text-claude-muted">
          {breadcrumb.map((item, index) => (
            <span key={index} className="flex shrink-0 items-center gap-1">
              {index > 0 && <span className="text-claude-border">›</span>}
              <span className="max-w-[9rem] truncate">{item}</span>
            </span>
          ))}
          <span className="shrink-0 text-claude-border">›</span>
          <span className="max-w-[9rem] shrink-0 truncate text-claude-accent">{card.term}</span>
        </div>
      )}

      {/* 主体 */}
      <div
        ref={scrollRef}
        onMouseUp={handleSelection}
        onMouseDown={() => setQuoteBtn(null)}
        className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-3", isPending && "flex flex-col")}
      >
        {card.explanation && (
          <div className={cn("rounded-2xl border border-claude-accent/20 bg-claude-accentSoft/55 px-3 py-2.5 text-xs leading-5 text-claude-ink", !isPending && "mb-3")}>
            <div className="mb-1 font-extrabold">{card.term}</div>
            <div>{card.explanation}</div>
          </div>
        )}

        {isPending ? (
          <>
            {card.messages.length > 0 && (
              <div className="mb-3">
                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-claude-panel/60 px-2 py-1 text-[10px] font-bold text-claude-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-island-lavender" />
                  切换前的回答（发送新问题后将重新生成）
                </div>
                {renderMessages(card.messages)}
              </div>
            )}
            <div className="mt-4 flex flex-col items-center gap-2 px-2 text-center">
              <p className="text-sm font-bold text-claude-ink">想怎么了解「{card.term}」？</p>
              <p className="text-xs text-claude-muted">补充你想问的问题（或直接发送默认讲解），也可以选中回答文本追问或引用</p>
            </div>
          </>
        ) : (
          <>
            {card.status === "opening" && card.messages.length > 0 && (
              <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-claude-accentSoft/60 px-2 py-1 text-[10px] font-bold text-claude-accent">
                <Loader2 size={11} className="animate-spin" /> 正在重新生成，新回答将替换下方内容…
              </div>
            )}
            {card.messages.length === 0 && card.status === "opening" && (
              <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs font-bold text-claude-muted">
                <Loader2 size={14} className="animate-spin text-claude-accent" />
                {card.mode === "branch" ? "正在创建分支对话…" : "正在生成探索卡片…"}
              </div>
            )}
            {renderMessages(card.messages)}
            {card.status === "error" && card.error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-500">{card.error}</div>
            )}
          </>
        )}
      </div>

      {/* 选中文本 → 「追问 / 引用」操作条（portal 到 body，避免卡片 transform 影响 fixed 定位） */}
      {quoteBtn &&
        createPortal(
          <div
            style={{ left: quoteBtn.x - 84, top: quoteBtn.y }}
            className="fixed z-[80] flex items-center gap-0.5 rounded-full border border-white bg-white/95 p-1 shadow-island backdrop-blur"
          >
            <button
              type="button"
              onClick={() => {
                const clean = quoteBtn.text.replace(/\s+/g, " ").trim();
                drill(clean, undefined, quoteBtn.bubbleText);
                setQuoteBtn(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="flex items-center gap-1 rounded-full bg-claude-accent px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-claude-accentHover"
              title="以选中内容为名词打开追问卡片"
            >
              <Search size={12} /> 追问
            </button>
            <button
              type="button"
              onClick={() => {
                setQuote(quoteBtn.text);
                setQuoteBtn(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-claude-muted transition-colors hover:bg-claude-panel hover:text-claude-ink"
              title="把选中内容作为引用，随下一条提问发送"
            >
              <QuoteIcon size={12} /> 引用
            </button>
          </div>,
          document.body
        )}

      {/* 底部：模式切换 + 输入区 */}
      <div className="border-t border-claude-border/70 bg-white/75 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          {MODE_ORDER.map((mode) => {
            const m = MODE_META[mode];
            const active = card.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={card.status === "streaming"}
                onClick={() => switchExploreMode(card.key, mode)}
                title={`切换为${m.label}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold transition-colors disabled:opacity-50",
                  active ? "border-claude-accent bg-claude-accent text-white" : "border-claude-border/70 bg-white text-claude-muted hover:border-claude-accent/40 hover:text-claude-accent"
                )}
              >
                <span>{m.icon}</span>
                {m.short}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] font-bold text-claude-muted">
            {card.status === "streaming" ? "生成中…" : isPending ? "补充问题后发送" : "点术语或选中文本可继续下钻"}
          </span>
        </div>

        {card.status === "error" ? (
          <button
            type="button"
            onClick={() => { setInput(""); setQuote(null); resetExploreCard(card.key); }}
            className="w-full rounded-2xl border border-claude-accent/40 bg-claude-accentSoft py-2 text-xs font-bold text-claude-accent transition-colors hover:bg-claude-accent hover:text-white"
          >
            重新生成（可修改问题）
          </button>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white bg-white shadow-soft focus-within:ring-4 focus-within:ring-claude-accent/15">
            {quote && (
              <div className="flex items-start gap-2 border-b border-claude-border/60 bg-claude-accentSoft/50 px-2.5 py-1.5 text-xs text-claude-ink">
                <QuoteIcon size={12} className="mt-0.5 shrink-0 text-claude-accent" />
                <div className="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap text-claude-muted">{quote}</div>
                <button type="button" onClick={() => setQuote(null)} className="shrink-0 rounded-full p-0.5 text-claude-muted hover:bg-white hover:text-claude-ink" title="移除引用"><X size={12} /></button>
              </div>
            )}
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              disabled={card.status === "streaming"}
              placeholder={
                card.status === "streaming"
                  ? "正在回答…"
                  : card.mode === "branch" && !isPending
                  ? "在分支中继续追问…"
                  : isPending
                  ? meta.placeholder
                  : `继续追问「${card.term}」…（将重新生成）`
              }
              className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div className="flex items-center justify-between border-t border-claude-border/60 px-2 py-1.5">
              <span className="max-w-[240px] truncate text-[10px] font-bold text-claude-muted">
                {card.mode === "branch" && !isPending ? "独立分支对话" : "Enter 发送 · Shift+Enter 换行"}
              </span>
              <button
                type="button"
                onClick={() => void send()}
                disabled={card.status === "streaming" || (!input.trim() && !quote)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-claude-accent text-white disabled:opacity-40"
                title="发送"
              >
                {card.status === "streaming" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 右下角缩放把手 */}
      <div
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        className="absolute bottom-0 right-0 z-10 flex h-6 w-6 cursor-nwse-resize touch-none items-end justify-end rounded-bl-xl p-0.5 text-claude-muted/60 select-none hover:text-claude-accent"
        title="拖动调整卡片大小"
      >
        <MoveDiagonal size={13} />
      </div>
    </aside>
  );
}
