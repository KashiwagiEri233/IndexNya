import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowRight, ArrowUpRight, GripVertical, Loader2, MoveDiagonal, Quote as QuoteIcon, Search, Send, X } from "lucide-react";
import { Markdown } from "@/components/chat/Markdown";
import { openExploreCard, resetExploreCard, sendBranchMessage, startExploreCard, switchExploreMode } from "@/lib/explore";
import type { ChatTerm, ExploreMode } from "@/lib/api";
import { useAppStore, type ExploreCardState } from "@/stores/app";
import { cn } from "@/lib/utils";

const MODE_META: Record<ExploreMode, { label: string; short: string; icon: typeof ArrowUpRight; badge: string; placeholder: string }> = {
  child: { label: "子卡片 · 深挖背景", short: "深挖", icon: ArrowUpRight, badge: "bg-island-sky/25 text-[#4358c0]", placeholder: "想深挖哪部分？例如：它的前置知识 / 原理细节…（留空则默认讲解）" },
  related: { label: "关联卡片 · 横向对比", short: "对比", icon: ArrowRight, badge: "bg-island-orange/25 text-[#a05a28]", placeholder: "想对比哪些方面？例如：它和 XX 有什么区别…（留空则默认发散对比）" },
  branch: { label: "分支卡片 · 继承上下文", short: "分支", icon: ArrowDown, badge: "bg-island-lavender/25 text-[#7a3fd0]", placeholder: "想从分支聊什么？留空则默认讲解该名词…" },
};

const MODE_ORDER: ExploreMode[] = ["child", "related", "branch"];

/** 卡片最小尺寸（Windows 式自由缩放，允许缩得较小） */
const MIN_W = 220;
const MIN_H = 150;
/** 卡片与视口边缘的最小间距 */
const EDGE = 8;

/** 八向缩放方向（n/s/e/w + 四角），对应 Windows 窗口的调整手柄 */
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_HANDLES: { dir: ResizeDir; className: string; cursor: string }[] = [
  { dir: "n", className: "left-3 right-3 top-0 h-1.5", cursor: "cursor-ns-resize" },
  { dir: "s", className: "bottom-0 left-3 right-3 h-1.5", cursor: "cursor-ns-resize" },
  { dir: "e", className: "right-0 top-3 bottom-3 w-1.5", cursor: "cursor-ew-resize" },
  { dir: "w", className: "left-0 top-3 bottom-3 w-1.5", cursor: "cursor-ew-resize" },
  { dir: "ne", className: "right-0 top-0 h-3 w-3", cursor: "cursor-nesw-resize" },
  { dir: "nw", className: "left-0 top-0 h-3 w-3", cursor: "cursor-nwse-resize" },
  { dir: "se", className: "bottom-0 right-0 h-3 w-3", cursor: "cursor-nwse-resize" },
  { dir: "sw", className: "bottom-0 left-0 h-3 w-3", cursor: "cursor-nesw-resize" },
];

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
  const resizeRef = useRef<{ dir: ResizeDir; startX: number; startY: number; originW: number; originH: number; originX: number; originY: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const exploreClose = useAppStore((s) => s.exploreClose);
  const focusCardKey = useAppStore((s) => s.focusCardKey);
  const meta = MODE_META[card.mode];
  const isPending = card.status === "pending";
  const focused = focusCardKey === card.key;

  /** 卡片锚定：right = R + x，top = T + y（与探索卡片坞的级联偏移一致） */
  const R = 16 + depth * 24;
  const T = 84 + depth * 26;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [card.messages]);

  // —— 输入框随内容与卡片尺寸自适应（不再固定 2 行） ——
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = Math.max(64, Math.min(220, size.h * 0.35));
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, [input, quote, size.h]);

  // —— 移动（header 拖动）：卡片以 right 锚定，水平偏移取反，保证跟随鼠标 ——
  function clampPosition(x: number, y: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.max(EDGE - R, Math.min(x, vw - EDGE - R - size.w));
    const cy = Math.max(EDGE - T, Math.min(y, vh - EDGE - T - size.h));
    return { x: cx, y: cy };
  }
  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: dragOffset.x, originY: dragOffset.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    const next = clampPosition(
      dragRef.current.originX - (event.clientX - dragRef.current.startX),
      dragRef.current.originY + (event.clientY - dragRef.current.startY),
    );
    setDragOffset(next);
  }
  function endDrag() {
    dragRef.current = null;
  }

  // —— 缩放（Windows 式：四边 + 四角拖拽，任意方向自由调整） ——
  function startResize(dir: ResizeDir) {
    return (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = {
        dir,
        startX: event.clientX,
        startY: event.clientY,
        originW: size.w,
        originH: size.h,
        originX: dragOffset.x,
        originY: dragOffset.y,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
  }
  function moveResize(event: React.PointerEvent<HTMLElement>) {
    const ref = resizeRef.current;
    if (!ref) return;
    const dx = event.clientX - ref.startX;
    const dy = event.clientY - ref.startY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let w = ref.originW;
    let h = ref.originH;
    if (ref.dir.includes("e")) w = ref.originW + dx;
    if (ref.dir.includes("s")) h = ref.originH + dy;
    if (ref.dir.includes("w")) w = ref.originW - dx;
    if (ref.dir.includes("n")) h = ref.originH - dy;

    // 尺寸钳制：最小 MIN_W/MIN_H，最大不超出视口
    w = Math.max(MIN_W, Math.min(w, vw - EDGE * 2));
    h = Math.max(MIN_H, Math.min(h, vh - EDGE * 2));
    const dw = w - ref.originW;
    const dh = h - ref.originH;

    let x = ref.originX;
    let y = ref.originY;
    if (ref.dir.includes("e")) x = ref.originX - dw;   // 右缘拖动：左缘固定
    if (ref.dir.includes("n")) y = ref.originY - dh;   // 上缘拖动：下缘固定
    const next = clampPosition(x, y);

    setSize({ w, h });
    setDragOffset(next);
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
                message.role === "user" ? "rounded-br-md bg-island-user" : "rounded-bl-md border border-island-border bg-island-card"
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
                  <span className="text-island-muted">…</span>
                )
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              )}
              {message.streaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse align-middle bg-island-accent" />}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <aside
      style={{
        right: `${R + dragOffset.x}px`,
        top: `${T + dragOffset.y}px`,
        width: size.w,
        height: size.h,
        zIndex: focused ? 300 : 40 + depth,
      }}
      className={cn(
        "fixed flex flex-col overflow-hidden rounded-[1.5rem] border border-island-border bg-island-content shadow-island",
        focused && "border-island-accent ring-4 ring-island-accent/30",
        card.closing ? "explore-card-out" : "explore-card-in"
      )}
    >
      {/* Windows 式八向缩放手柄（隐藏热区，悬停显示光标） */}
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.dir}
          onPointerDown={startResize(handle.dir)}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className={cn("absolute z-30 touch-none select-none", handle.className, handle.cursor)}
        />
      ))}
      {/* 右下角可见缩放把手（装饰） */}
      <div className="pointer-events-none absolute bottom-0 right-0 z-20 flex h-6 w-6 items-end justify-end rounded-bl-xl p-0.5 text-island-muted/50 select-none">
        <MoveDiagonal size={13} />
      </div>

      <header
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-move select-none items-center justify-between border-b border-island-border bg-island-card/90 px-4 py-3 backdrop-blur"
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical size={15} className="shrink-0 text-island-muted/70" />
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px]", meta.badge)}>
            <meta.icon size={15} strokeWidth={2.6} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-island-ink">{card.term}</div>
            <div className="truncate text-[10px] text-island-muted">{meta.label}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => exploreClose(card.key)}
          className="rounded-full p-1.5 text-island-muted hover:bg-island-panel hover:text-island-ink"
          title="关闭卡片"
        >
          <X size={16} />
        </button>
      </header>

      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-island-border bg-island-card/60 px-4 py-1.5 text-[10px] font-bold text-island-muted">
          {breadcrumb.map((item, index) => (
            <span key={index} className="flex shrink-0 items-center gap-1">
              {index > 0 && <span className="text-island-border">›</span>}
              <span className="max-w-[9rem] truncate">{item}</span>
            </span>
          ))}
          <span className="shrink-0 text-island-border">›</span>
          <span className="max-w-[9rem] shrink-0 truncate text-island-accent">{card.term}</span>
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
          <div className={cn("rounded-2xl border border-island-accent/20 bg-island-accentSoft/55 px-3 py-2.5 text-xs leading-5 text-island-ink", !isPending && "mb-3")}>
            <div className="mb-1 font-extrabold">{card.term}</div>
            <div>{card.explanation}</div>
          </div>
        )}

        {isPending ? (
          <>
            {card.messages.length > 0 && (
              <div className="mb-3">
                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-island-panel/60 px-2 py-1 text-[10px] font-bold text-island-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-island-lavender" />
                  切换前的回答（发送新问题后将重新生成）
                </div>
                {renderMessages(card.messages)}
              </div>
            )}
            <div className="mt-4 flex flex-col items-center gap-2 px-2 text-center">
              <p className="text-sm font-bold text-island-ink">想怎么了解「{card.term}」？</p>
              <p className="text-xs text-island-muted">补充你想问的问题（或直接发送默认讲解），也可以选中回答文本追问或引用</p>
            </div>
          </>
        ) : (
          <>
            {card.status === "opening" && card.messages.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-island-accentSoft/60 px-2 py-1 text-[10px] font-bold text-island-accent">
                <Loader2 size={11} className="animate-spin" /> 正在重新生成，新回答将替换下方内容…
              </div>
            )}
            {card.messages.length === 0 && card.status === "opening" && (
              <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs font-bold text-island-muted">
                <Loader2 size={14} className="animate-spin text-island-accent" />
                {card.mode === "branch" ? "正在创建分支对话…" : "正在生成探索卡片…"}
              </div>
            )}
            {renderMessages(card.messages)}
            {card.status === "error" && card.error && (
              <div className="rounded-[14px] border-2 border-island-error/30 bg-island-error/10 px-3 py-2 text-xs font-semibold text-island-error">{card.error}</div>
            )}
          </>
        )}
      </div>

      {/* 选中文本 → 「追问 / 引用」操作条（portal 到 body，避免卡片 transform 影响 fixed 定位） */}
      {quoteBtn &&
        createPortal(
          <div
            style={{ left: quoteBtn.x - 84, top: quoteBtn.y }}
            className="fixed z-[80] flex items-center gap-0.5 rounded-full border border-island-border bg-island-card/95 p-1 shadow-island backdrop-blur"
          >
            <button
              type="button"
              onClick={() => {
                const clean = quoteBtn.text.replace(/\s+/g, " ").trim();
                drill(clean, undefined, quoteBtn.bubbleText);
                setQuoteBtn(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="flex items-center gap-1 rounded-full bg-island-accent px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-island-accentHover"
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
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-island-muted transition-colors hover:bg-island-panel hover:text-island-ink"
              title="把选中内容作为引用，随下一条提问发送"
            >
              <QuoteIcon size={12} /> 引用
            </button>
          </div>,
          document.body
        )}

      {/* 底部：模式切换 + 输入区 */}
      <div className="border-t border-island-border bg-island-card/75 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
                  "inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-1 text-[11px] font-bold transition-all duration-200 ease-island disabled:opacity-50",
                  active ? "border-island-accent bg-island-accent text-white" : "border-island-border bg-island-card text-island-muted hover:-translate-y-px hover:border-island-accent/60 hover:text-island-accentDeep"
                )}
              >
                <m.icon size={12} strokeWidth={2.6} />
                {m.short}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] font-bold text-island-muted">
            {card.status === "streaming" ? "生成中…" : isPending ? "补充问题后发送" : "点术语或选中文本可继续下钻"}
          </span>
        </div>

        {card.status === "error" ? (
          <button
            type="button"
            onClick={() => { setInput(""); setQuote(null); resetExploreCard(card.key); }}
            className="w-full rounded-[16px] border-2 border-island-accent/40 bg-island-accentSoft py-2 text-xs font-bold text-island-accentDeep transition-colors hover:bg-island-accent hover:text-white"
          >
            重新生成（可修改问题）
          </button>
        ) : (
          <div className="overflow-hidden rounded-[20px] border-2 border-island-border bg-island-card shadow-soft transition-all duration-200 ease-island focus-within:border-island-accent focus-within:ring-2 focus-within:ring-island-focus/70">
            {quote && (
              <div className="flex items-start gap-2 border-b border-island-border bg-island-accentSoft/60 px-2.5 py-1.5 text-xs text-island-ink">
                <QuoteIcon size={12} className="mt-0.5 shrink-0 text-island-accentDeep" />
                <div className="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap text-island-muted">{quote}</div>
                <button type="button" onClick={() => setQuote(null)} className="shrink-0 rounded-full p-0.5 text-island-muted hover:bg-island-card hover:text-island-ink" title="移除引用"><X size={12} /></button>
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
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
              className="w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div className="flex items-center justify-between border-t border-island-border px-2 py-1.5">
              <span className="max-w-[240px] truncate text-[10px] font-bold text-island-muted">
                {card.mode === "branch" && !isPending ? "独立分支对话" : "Enter 发送 · Shift+Enter 换行"}
              </span>
              <button
                type="button"
                onClick={() => void send()}
                disabled={card.status === "streaming" || (!input.trim() && !quote)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-island-accent text-white shadow-btn-3d-teal transition-all duration-200 ease-island hover:-translate-y-px hover:bg-island-accentHover hover:shadow-btn-3d-teal-hover active:translate-y-[2px] active:shadow-btn-3d-teal-active disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
                title="发送"
              >
                {card.status === "streaming" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
