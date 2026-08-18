import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send, Sparkles, FileText, Map as MapIcon, Loader2, Paperclip,
  Code, ListChecks, BookOpen, HelpCircle, PanelRight, GitBranch, X, Pencil, Trash2, Quote as QuoteIcon,
  Brain, Search, ArrowUpRight, ArrowRight, ArrowDown, ClipboardCheck, PenLine,
} from "lucide-react";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RibbonTitle } from "@/components/ui/ribbon";
import { Markdown } from "@/components/chat/Markdown";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { ReasoningSelector } from "@/components/chat/ReasoningSelector";
import { ExploreDock } from "@/components/explore/ExploreDock";
import { openExploreCard } from "@/lib/explore";
import { api, type ChatTerm } from "@/lib/api";
import { useAppStore, requestModelOf, resolveModelEntry, resolveSelectedModel, type SelectedModelEntry } from "@/stores/app";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id?: number;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  route?: { action: string; resource_type?: string; topic?: string; skill?: string };
  terms?: ChatTerm[];
  modelId?: string;
  progress?: { phase: string; agent: string; status: string; detail?: string };
  edited?: boolean;
  /** 互动刷题卡片（由后端 quiz SSE 事件下发） */
  quiz?: { action: "question" | "summary"; question?: string; options?: string[]; index?: number; score?: number; session?: any };
}

const ROUTE_LABELS: Record<string, string> = {
  lecture: "讲解文档", mindmap: "思维导图", quiz: "练习题库",
  reading: "拓展阅读", code: "代码实操",
};

// 资源快捷入口（讲解/导图/题库/阅读/代码）；插图与 PPT 已移除
const RESOURCE_ACTIONS = [
  { type: "lecture", label: "讲解文档", icon: FileText },
  { type: "mindmap", label: "思维导图", icon: MapIcon },
  { type: "quiz", label: "练习题库", icon: ListChecks },
  { type: "reading", label: "拓展阅读", icon: BookOpen },
  { type: "code", label: "代码实操", icon: Code },
] as const;

// 欢迎页展示全部功能（含路由自动调用的智能体）
const ALL_FEATURES = [
  { label: "讲解文档", icon: FileText },
  { label: "思维导图", icon: MapIcon },
  { label: "练习题库", icon: ListChecks },
  { label: "互动刷题", icon: ClipboardCheck },
  { label: "拓展阅读", icon: BookOpen },
  { label: "代码实操", icon: Code },
  { label: "图片理解", icon: HelpCircle },
] as const;

/** 互动刷题卡片：展示选项按钮与结束入口；题目文本已随消息内容展示。 */
function QuizCard({ quiz, onAnswer }: { quiz: NonNullable<ChatMsg["quiz"]>; onAnswer: (text: string) => void }) {
  const answered = quiz.action === "summary";
  const session = quiz.session as any;
  const answeredCount = session?.index ?? quiz.index ?? 0;
  const score = session?.score ?? quiz.score ?? 0;
  return (
    <div className={cn("mt-3 rounded-[16px] border-2 p-3", answered ? "border-island-border bg-island-panel/40" : "border-island-lavender/40 bg-island-lavender/5")}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("inline-flex items-center gap-1 text-xs font-bold", answered ? "text-island-muted" : "text-island-lavender")}>
          <ClipboardCheck size={13} /> {answered ? "练习结束" : `第 ${answeredCount} 题`}
        </span>
        {answered ? (
          <span className="text-[10px] text-island-muted">共作答 {answeredCount} 题 · 答对 {score} 题</span>
        ) : (
          <span className="text-[10px] text-island-muted">已答对 {score} 题</span>
        )}
      </div>
      {answered ? (
        <p className="mt-2 text-xs text-island-muted">本轮互动刷题已完成，批改与小结见上方消息。想继续可以再说「再来几题」。</p>
      ) : (
        <>
          {quiz.options && quiz.options.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {quiz.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onAnswer(`我的答案：${opt}`)}
                  className="rounded-[14px] border-2 border-island-border bg-island-card px-3 py-1.5 text-left text-xs font-medium transition-all duration-200 ease-island hover:-translate-y-px hover:border-island-lavender/60 hover:bg-island-lavender/10"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-island-muted">{quiz.options?.length ? "点选项直接作答" : "在下方输入框输入答案后回车"}</span>
            <button
              type="button"
              onClick={() => onAnswer("结束练习")}
              className="shrink-0 rounded-full border-2 border-island-border px-2.5 py-0.5 text-[10px] font-bold text-island-muted transition-colors hover:bg-island-panel"
            >
              结束练习
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function toRequestModel(entry: SelectedModelEntry | undefined) {
  return requestModelOf(entry);
}

/** 用自己的话表达理解的候选检测（启发式，命中后提示沉淀到思维宇宙）。 */
const INSIGHT_MARKERS = ["我认为", "我觉得", "说白了", "其实", "本质上", "换句话说", "我的理解是", "就是说", "可以理解为", "简单来说"];
function isInsightCandidate(text: string) {
  const trimmed = (text || "").trim();
  if (trimmed.length < 20) return false;
  if (/[?？]$/.test(trimmed)) return false;
  return INSIGHT_MARKERS.some((marker) => trimmed.includes(marker));
}

/** 从消息内容提取一个简短主题（无术语时兜底）。 */
function topicOf(message: ChatMsg): string {
  const terms = message.terms;
  if (terms && terms.length > 0) return terms[0].text;
  const clean = message.content.replace(/[#*`>\-\[\]()]/g, "").trim();
  return clean.slice(0, 14) || "这段内容";
}

/** 把后端消息行映射为前端消息；互动刷题卡片从 meta.quiz_session 重建。 */
function msgFromRow(m: any): ChatMsg {
  const qs = m?.meta?.quiz_session;
  const items = qs && Array.isArray(qs.items) ? qs.items : [];
  const last = items[items.length - 1];
  const quiz = qs
    ? qs.active
      ? { action: "question" as const, question: last?.question, options: last?.options ?? [], index: qs.index ?? 0, score: qs.score ?? 0, session: qs }
      : { action: "summary" as const, index: qs.index ?? 0, score: qs.score ?? 0, session: qs }
    : undefined;
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    route: m.meta?.action ? { action: m.meta.action } : undefined,
    terms: Array.isArray(m.meta?.terms) ? m.meta.terms : undefined,
    modelId: m.meta?.model_id || undefined,
    edited: Boolean(m.meta?.edited),
    quiz,
  };
}

function SideChatPanel({
  conversationId,
  modelKey,
  onClose,
}: {
  conversationId: number;
  /** 模型选择 key（providerId::modelId）；缺省时使用当前选中模型 */
  modelKey?: string;
  onClose: () => void;
}) {
  const providers = useAppStore((s) => s.providers);
  const selectedModelKey = useAppStore((s) => s.selectedModelKey);
  const sideEntry = useMemo(
    () => resolveModelEntry(providers, modelKey) ?? resolveSelectedModel({ providers, selectedModelKey }),
    [providers, modelKey, selectedModelKey]
  );
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string; bubbleText: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    api.getMessages(conversationId).then((rows) => {
      if (!cancelled) setMessages(rows.map((m: any) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
        terms: Array.isArray(m.meta?.terms) ? m.meta.terms : undefined,
      })));
    }).catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 选中 assistant 文本 → 「追问 / 引用」操作条（与主对话一致）
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

  function openSelectionFollowUp(text: string, bubbleText: string) {
    if (!text) return;
    const clean = text.replace(/\s+/g, " ").trim();
    openExploreCard({
      term: clean.slice(0, 40),
      context: bubbleText,
      mode: "child",
      conversationId,
    });
  }

  function onTermClick(term: ChatTerm, context: string, messageId?: number) {
    openExploreCard({
      term: term.text,
      explanation: term.explanation,
      context,
      mode: term.relation === "related" ? "related" : "child",
      conversationId,
      sourceMessageId: messageId,
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setQuote(null);
    const context = quote ? `被引用的内容：${quote}` : undefined;
    const assistantIdx = messages.length + 1;
    setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "", streaming: true }]);
    setBusy(true);
    try {
      await api.chatStream(
        { conversation_id: conversationId, message: text, model: toRequestModel(sideEntry), context },
        {
          onToken: (token) => setMessages((current) => {
            const next = [...current];
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], content: next[assistantIdx].content + token };
            return next;
          }),
          onTerms: (d) => setMessages((current) => {
            const next = [...current];
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], terms: Array.isArray(d.terms) ? d.terms : [] };
            return next;
          }),
          onDone: () => setMessages((current) => {
            const next = [...current];
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], streaming: false };
            return next;
          }),
          onError: (message) => setMessages((current) => {
            const next = [...current];
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], content: `出错了：${message}`, streaming: false };
            return next;
          }),
        },
      );
    } catch (error: any) {
      setMessages((current) => {
        const next = [...current];
        if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], content: `出错了：${error.message}`, streaming: false };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="relative flex w-[min(430px,42vw)] shrink-0 flex-col border-l border-island-border bg-island-content/60">
      <div className="flex min-h-[4.25rem] items-center justify-between border-b border-island-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[12px] bg-island-lavender/25 text-[#7a3fd0]"><GitBranch size={15} /></div>
          <div className="min-w-0"><div className="truncate text-sm font-extrabold">侧边对话</div><div className="text-[10px] text-island-muted">基于当前上下文的独立分支</div></div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-island-muted hover:bg-island-card hover:text-island-ink" title="关闭侧边对话"><X size={16} /></button>
      </div>
      <div ref={scrollRef} onMouseUp={handleSelection} onMouseDown={() => setQuoteBtn(null)} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={cn("flex gap-2", message.role === "user" ? "justify-end" : "")}>
              {message.role === "assistant" && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[12px] bg-island-accent text-white"><Sparkles size={13} /></div>}
              <div className={cn("max-w-[88%] rounded-[18px] px-3 py-2 text-sm shadow-soft", message.role === "user" ? "rounded-br-md bg-island-user" : "rounded-bl-md border border-island-border bg-island-card")}>
                {message.role === "assistant" ? (
                  message.content ? (
                    <div data-bubble="assistant">
                      <Markdown terms={message.terms} onTermClick={(term) => onTermClick(term, message.content, message.id)}>{message.content}</Markdown>
                    </div>
                  ) : (
                    <span className="text-island-muted">…</span>
                  )
                ) : <div className="whitespace-pre-wrap">{message.content}</div>}
                {message.streaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse align-middle bg-island-accent" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 选中文本 → 「追问 / 引用」操作条 */}
      {quoteBtn && (
        <div
          style={{ left: quoteBtn.x - 84, top: quoteBtn.y }}
          className="fixed z-[80] flex items-center gap-0.5 rounded-full border border-island-border bg-island-card/95 p-1 shadow-island backdrop-blur"
        >
          <button
            type="button"
            onClick={() => {
              openSelectionFollowUp(quoteBtn.text, quoteBtn.bubbleText);
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
              if (quoteBtn.text) setQuote(quoteBtn.text);
              setQuoteBtn(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-island-muted transition-colors hover:bg-island-panel hover:text-island-ink"
            title="把选中内容作为引用带入输入框"
          >
            <QuoteIcon size={12} /> 引用
          </button>
        </div>
      )}

      <div className="border-t border-island-border bg-island-card/70 p-3">
        {quote && (
          <div className="mb-2 flex items-start gap-2 rounded-[14px] border border-island-accent/30 bg-island-accentSoft/60 px-2.5 py-1.5 text-xs text-island-ink">
            <QuoteIcon size={12} className="mt-0.5 shrink-0 text-island-accentDeep" />
            <div className="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap text-island-muted">{quote}</div>
            <button type="button" onClick={() => setQuote(null)} className="shrink-0 rounded-full p-0.5 text-island-muted hover:bg-island-card hover:text-island-ink" title="移除引用"><X size={12} /></button>
          </div>
        )}
        <div className="overflow-hidden rounded-[20px] border-2 border-island-border bg-island-card transition-all duration-200 ease-island focus-within:border-island-accent focus-within:ring-2 focus-within:ring-island-focus/70">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} placeholder="在侧边分支中继续追问…" className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none" />
          <div className="flex items-center justify-between border-t border-island-border px-2 py-1.5">
            <span className="max-w-[190px] truncate text-[10px] font-bold text-island-muted">{sideEntry ? `${sideEntry.provider.name} · ${sideEntry.model.name}` : "未选择模型"}</span>
            <button type="button" onClick={send} disabled={busy || !input.trim()} className="flex h-8 w-8 items-center justify-center rounded-full bg-island-accent text-white shadow-btn-3d-teal transition-all duration-200 ease-island hover:-translate-y-px hover:bg-island-accentHover hover:shadow-btn-3d-teal-hover active:translate-y-[2px] active:shadow-btn-3d-teal-active disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none" title="发送">{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function ChatPage() {
  const navigate = useNavigate();
  const convId = useAppStore((s) => s.convId);
  const setConvId = useAppStore((s) => s.setConvId);
  const bumpConversations = useAppStore((s) => s.bumpConversations);
  const setPendingInsight = useAppStore((s) => s.setPendingInsight);
  const providers = useAppStore((s) => s.providers);
  const selectedModelKey = useAppStore((s) => s.selectedModelKey);
  const selectedModel = useMemo(
    () => resolveSelectedModel({ providers, selectedModelKey }),
    [providers, selectedModelKey]
  );

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingResource, setPendingResource] = useState<string | null>(null);
  const [quizMode, setQuizMode] = useState(false);
  const [sideConvId, setSideConvId] = useState<number | null>(null);
  const [sideModelKey, setSideModelKey] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 首条消息创建新会话时，onMeta 会更新 convId；跳过这一次历史拉取，避免覆盖正在流式生成的本地消息。
  const skipHistoryLoadForRef = useRef<number | null>(null);

  // 错题本「重练错题」一键直达：自动发送拼好的消息并清空待发状态
  const pendingPracticeMessage = useAppStore((s) => s.pendingPracticeMessage);
  const setPendingPracticeMessage = useAppStore((s) => s.setPendingPracticeMessage);
  useEffect(() => {
    if (pendingPracticeMessage) {
      const text = pendingPracticeMessage.text;
      setPendingPracticeMessage(null);
      void send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPracticeMessage]);

  // 编辑 / 引用 / 删除状态
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string; bubbleText: string } | null>(null);

  async function refreshMessages(targetConvId: number) {
    try {
      const rows = await api.getMessages(targetConvId);
      setMessages(rows.map(msgFromRow));
    } catch {
      /* 静默 */
    }
  }

  // 拉取当前对话的历史消息（convId 变化时）
  useEffect(() => {
    setSideConvId(null);
    setSideModelKey(undefined);
    if (!convId) {
      setMessages([]);
      return;
    }
    if (skipHistoryLoadForRef.current === convId) {
      skipHistoryLoadForRef.current = null;
      return;
    }
    let cancelled = false;
    api.getMessages(convId).then((rows) => {
      if (cancelled) return;
      setMessages(rows.map(msgFromRow));
    }).catch(() => {
      if (!cancelled) setMessages([]);
    });
    return () => { cancelled = true; };
  }, [convId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 选中文本 → 「引用 / 追问」操作条（仅 assistant 气泡内的选择）
  function handleSelection(event: React.MouseEvent) {
    // 点击按钮（术语等）时不弹操作条，避免遮挡后续点击
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

  /** 选中任意文本（名词之外的内容）→ 打开追问卡片。 */
  function openSelectionFollowUp(text: string, bubbleText: string) {
    if (!text) return;
    const clean = text.replace(/\s+/g, " ").trim();
    openExploreCard({
      term: clean.slice(0, 40),
      context: bubbleText,
      mode: "child",
      conversationId: convId ?? undefined,
    });
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    if (!selectedModel) {
      alert("请先添加并选择一个对话模型。");
      return;
    }
    // 如果选中了某个资源智能体，走资源生成分支
    if (!textOverride && pendingResource) {
      const type = pendingResource;
      setPendingResource(null);
      setInput("");
      await generateResource(type, text);
      return;
    }
    const useQuizMode = !textOverride && quizMode;
    if (quizMode) setQuizMode(false);
    setInput("");
    setQuote(null);
    const context = quote ? `被引用的内容：${quote}` : undefined;
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", streaming: true, modelId: selectedModel?.key }]);
    setBusy(true);
    let assistantIdx = -1;
    setMessages((m) => {
      const copy = [...m];
      assistantIdx = copy.length - 1;
      return copy;
    });

    try {
      await api.chatStream(
        {
          conversation_id: convId ?? undefined,
          message: text,
          mode: useQuizMode ? "quiz_session" : undefined,
          model: toRequestModel(selectedModel),
          context,
        },
        {
          onMeta: (d) => {
            if (d.conversation_id) {
              skipHistoryLoadForRef.current = d.conversation_id;
              setConvId(d.conversation_id);
              bumpConversations();
            }
          },
          onRoute: (d) => {
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], route: { action: d.action, resource_type: d.resource_type, skill: d.skill, topic: d.topic } };
              }
              return copy;
            });
          },
          onSkill: (d) => {
            // 技能徽标展示由 route 事件的 action=skill 承担；这里仅确保其可见。
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                const route = copy[assistantIdx].route ?? { action: "skill" };
                copy[assistantIdx] = { ...copy[assistantIdx], route: { ...route, action: "skill", skill: route.skill ?? d?.skill } };
              }
              return copy;
            });
          },
          onQuiz: (d) => {
            // 互动刷题卡片：题目文本已随 token 流进入消息内容，这里仅挂载交互控件数据。
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], quiz: { action: d.action, question: d.question, options: Array.isArray(d.options) ? d.options : [], index: d.index ?? d.session?.index ?? 0, score: d.score ?? d.session?.score ?? 0, session: d.session } };
              }
              return copy;
            });
          },
          onTerms: (d) => {
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], terms: Array.isArray(d.terms) ? d.terms : [] };
              }
              return copy;
            });
          },
          onProgress: (d) => {
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], progress: d };
              }
              return copy;
            });
          },
          onToken: (t) => {
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], content: copy[assistantIdx].content + t };
              }
              return copy;
            });
          },
          onDone: (d) => {            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], streaming: false };
              }
              return copy;
            });
            if (d?.conversation_id) void refreshMessages(d.conversation_id);
          },
          onError: (msg) => {
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], content: `出错了：${msg}`, streaming: false };
              }
              return copy;
            });
          },
        }
      );
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        if (assistantIdx >= 0 && copy[assistantIdx]) {
          copy[assistantIdx] = { ...copy[assistantIdx], content: `出错了：${e.message}`, streaming: false };
        }
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  async function generateResource(type: string, topic: string) {
    if (!topic.trim()) return;
    topic = topic.trim();
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: `生成【${type}】资源：${topic}` },
      { role: "assistant", content: "正在准备相关内容，请稍候…", streaming: true },
    ]);
    const assistantIdx = messages.length + 1;
    try {
      const r = await api.generateResource({ type, topic, conversation_id: convId ?? undefined, model: toRequestModel(selectedModel) });
      let preview = "";
      if (r.type === "mindmap" && r.content?.markdown) {
        preview = `✅ 已生成思维导图：\n\n${r.content.markdown}`;
      } else if (r.content?.markdown) {
        preview = r.content.markdown;
      } else if (r.content?.mermaid) {
        preview = "```mermaid\n" + r.content.mermaid + "\n```";
      } else if (r.content?.questions) {
        preview = "题库已生成（共 " + r.content.questions.length + " 题），请在资源库查看。";
      } else if (r.content?.error) {
        preview = `出错了：生成失败：${r.content.error}`;
      } else {
        preview = "✅ 资源已生成，请在资源库查看。";
      }
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = { role: "assistant", content: preview, streaming: false };
        return copy;
      });
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = { role: "assistant", content: `出错了：生成失败：${e.message}`, streaming: false };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("只能上传图片文件");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      alert("图片不能超过 4MB");
      return;
    }
    setPendingImage(file);
    const question = input.trim() || "请描述这张图片并解释相关知识点";
    setInput("");
    setBusy(true);
    const url = URL.createObjectURL(file);
    setMessages((m) => [
      ...m,
      { role: "user", content: `📷 [图片提问] ${question}\n\n![上传图片](${url})` },
      { role: "assistant", content: "正在识别图片内容…", streaming: true },
    ]);
    const assistantIdx = messages.length + 1;
    try {
      const res = await api.understandImage(file, question);
      let content = res.answer || res.recognition || "（无识别结果）";
      if (res.recognition && res.answer && res.recognition !== res.answer) {
        content = `**识别内容：**\n\n${res.recognition}\n\n---\n\n**针对性解答：**\n\n${res.answer}`;
      }
      if (res.status === "failed") {
        content = `出错了：图片理解失败：${res.error}`;
      }
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = { role: "assistant", content, streaming: false };
        return copy;
      });
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = { role: "assistant", content: `出错了：${e.message}`, streaming: false };
        return copy;
      });
    } finally {
      setBusy(false);
      setPendingImage(null);
    }
  }

  /** 哪里不懂点哪里 — 点击术语打开探索卡片（先进入提问编辑态）。 */
  function openTerm(term: ChatTerm, context: string, message?: ChatMsg) {
    openExploreCard({
      term: term.text,
      explanation: term.explanation,
      context,
      mode: term.relation === "related" ? "related" : "child",
      conversationId: convId ?? undefined,
      sourceMessageId: message?.id,
      modelId: message?.modelId,
    });
  }

  /** assistant 消息悬浮按钮：深挖 / 发散 / 分支。 */
  function openExploreFromMessage(message: ChatMsg, mode: "child" | "related" | "branch") {
    const term = topicOf(message);
    openExploreCard({
      term,
      context: message.content,
      mode,
      conversationId: convId ?? undefined,
      sourceMessageId: message.id,
      modelId: message.modelId,
    });
  }

  async function saveEdit(messageId: number) {
    const text = editText.trim();
    if (!text) return;
    try {
      await api.updateMessage(messageId, text);
      setMessages((m) => m.map((item) => (item.id === messageId ? { ...item, content: text, edited: true } : item)));
      setEditingId(null);
    } catch (e: any) {
      alert(`编辑失败：${e.message}`);
    }
  }

  async function deleteRound(message: ChatMsg, index: number) {
    if (!window.confirm("确定删除这一轮对话吗？以它为来源的探索卡片也会一并删除。")) return;
    let targetId = message.id;
    let scope: "message" | "round" = "message";
    if (message.role === "assistant") {
      // 找到同一轮的用户消息，整轮删除
      for (let i = index - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          if (messages[i].id) {
            targetId = messages[i].id;
            scope = "round";
          }
          break;
        }
      }
    } else if (message.id) {
      scope = "round";
    }
    if (!targetId) {
      alert("这条消息还未保存，无法删除。");
      return;
    }
    try {
      const result = await api.deleteMessage(targetId, scope);
      setMessages((m) => m.filter((item) => !(item.id && result.deleted_ids.includes(item.id))));
    } catch (e: any) {
      alert(`删除失败：${e.message}`);
    }
  }

  function depositInsight(message: ChatMsg) {
    setPendingInsight({ concept: "", summary: message.content });
    navigate("/universe");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function openSideConversation() {
    if (!convId) {
      alert("请先在主对话中发送一条消息，再打开侧边对话。");
      return;
    }
    if (sideConvId) return;
    const parentModelId = [...messages].reverse().find((message) => message.role === "assistant" && message.modelId)?.modelId;
    const parentEntry = resolveModelEntry(providers, parentModelId) ?? selectedModel;
    try {
      const branch = await api.branchConversation(convId);
      setSideModelKey(parentEntry?.key);
      setSideConvId(branch.id);
      bumpConversations();
    } catch (error: any) {
      alert(`打开侧边对话失败：${error.message}`);
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
      {/* 头部 */}
      <header className="island-header">
        <RibbonTitle color="teal" icon={<Sparkles size={14} />}>学习对话</RibbonTitle>
        <button type="button" onClick={openSideConversation} disabled={!convId || !!sideConvId} className="btn-default h-9 px-3.5 text-xs" title="基于当前对话打开独立侧边分支">
          <PanelRight size={14} /> {sideConvId ? "侧边对话已打开" : "打开侧边对话"}
        </button>
      </header>

      {/* 消息流 */}
      <div ref={scrollRef} onMouseUp={handleSelection} onMouseDown={() => setQuoteBtn(null)} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {messages.length === 0 && (
            <div className="island-dot-pattern animate-float-in rounded-bubble border border-island-border bg-island-card/70 px-5 py-16 text-center text-island-muted">
              <Sparkles size={40} className="mx-auto mb-3 text-island-accentDeep" />
              <p className="text-lg font-extrabold text-island-ink">开始今天的学习</p>
              <p className="mt-2 text-sm">告诉我正在学什么、想弄清什么，或者直接输入一个学习目标。点击回答中的下划线术语，卡片会在旁边展开。</p>
              <div className="mt-6 grid grid-cols-3 gap-2 max-w-lg mx-auto text-left">
                {ALL_FEATURES.map((a) => (
                  <div key={a.label} className="card p-3 text-sm">
                    <a.icon size={16} className="mb-1 text-island-accentDeep" />
                    <div className="font-bold text-island-ink">{a.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("group relative flex gap-3 animate-fade-in", m.role === "user" ? "justify-end" : "")}>
              {m.role === "assistant" && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-island-accent text-white shadow-btn-3d-teal">
                  <Sparkles size={16} />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-[20px] px-4 py-3 shadow-soft",
                  m.role === "user"
                    ? "rounded-br-md bg-island-user text-island-ink"
                    : "rounded-bl-md border border-island-border bg-island-assistant"
                )}
              >
                {m.role === "assistant" ? (
                  <>
                    {m.progress && m.streaming && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-[12px] bg-island-panel/70 px-2 py-1 text-[11px] font-semibold text-island-muted">
                        <span className={cn("h-1.5 w-1.5 rounded-full", m.progress.status === "failed" ? "bg-island-error" : "bg-island-accent animate-pulse")} />
                        {m.progress.detail || `${m.progress.agent} 正在工作…`}
                      </div>
                    )}
                    {m.route && (
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="text-[11px] text-island-muted">由</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-island-accentSoft px-2 py-0.5 text-xs font-bold text-island-accentDeep">
                          {m.route.action === "resource"
                            ? ROUTE_LABELS[m.route.resource_type || ""] || `${m.route.resource_type}`
                            : m.route.action === "tutor"
                            ? "辅导回答"
                            : m.route.action === "skill"
                            ? `技能：${m.route.skill ?? "通用技能"}`
                            : m.route.action === "quiz_session"
                            ? "互动刷题"
                            : "学习问答"}
                        </span>
                        <span className="text-[11px] text-island-muted">回答</span>
                      </div>
                    )}
                    {m.content ? (
                      <div data-bubble="assistant">
                        <Markdown
                          terms={m.terms}
                          onTermClick={(term) => openTerm(term, m.content, m)}
                        >
                          {m.content}
                        </Markdown>
                        {m.quiz && <QuizCard quiz={m.quiz} onAnswer={(t) => send(t)} />}
                      </div>
                    ) : <span className="text-island-muted">…</span>}
                  </>
                ) : editingId === m.id ? (
                  <div className="w-[min(520px,60vw)]">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full resize-none rounded-[14px] border-2 border-island-accent/50 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-island-focus/70"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className="btn-ghost h-8 px-3 text-xs">取消</button>
                      <button type="button" onClick={() => m.id && saveEdit(m.id)} className="btn-accent h-8 px-4 text-xs">保存</button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}{m.edited && <span className="ml-1 text-[10px] text-island-muted">(已编辑)</span>}</div>
                )}
                {m.streaming && <span className="inline-block w-1.5 h-4 ml-1 bg-island-accent animate-pulse align-middle" />}
              </div>

              {/* 悬浮操作：assistant → 深挖/发散/分支/删除；user → 编辑/删除/沉淀
                  放在气泡外侧空白区（assistant 右侧 / user 左侧），避免遮挡气泡内的可点击术语 */}
              {!m.streaming && (
                <div
                  className="absolute top-0 z-10 flex items-center gap-0.5 rounded-full border border-island-border bg-island-card/95 px-1 py-0.5 opacity-0 shadow-soft transition-opacity group-hover:opacity-100"
                  style={m.role === "user" ? { left: 0 } : { right: 0 }}
                >
                  {m.role === "assistant" ? (
                    <>
                      <button type="button" onClick={() => openExploreFromMessage(m, "child")} title="深挖这段内容的背景知识" className="rounded-full p-1 text-island-muted hover:bg-island-accentSoft hover:text-island-accent"><ArrowUpRight size={13} /></button>
                      <button type="button" onClick={() => openExploreFromMessage(m, "related")} title="横向对比发散" className="rounded-full p-1 text-island-muted hover:bg-island-accentSoft hover:text-island-accent"><ArrowRight size={13} /></button>
                      <button type="button" onClick={() => openExploreFromMessage(m, "branch")} title="继承上下文另起分支" className="rounded-full p-1 text-island-muted hover:bg-island-accentSoft hover:text-island-accent"><ArrowDown size={13} /></button>
                      <span className="mx-0.5 h-3 w-px bg-island-border/70" />
                      <button type="button" onClick={() => deleteRound(m, i)} title="删除这一轮" className="rounded-full p-1 text-island-muted hover:bg-island-error/10 hover:text-island-error"><Trash2 size={13} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditingId(m.id ?? null); setEditText(m.content); }} title="编辑这条消息" className="rounded-full p-1 text-island-muted hover:bg-island-accentSoft hover:text-island-accent"><Pencil size={13} /></button>
                      <button type="button" onClick={() => deleteRound(m, i)} title="删除这一轮" className="rounded-full p-1 text-island-muted hover:bg-island-error/10 hover:text-island-error"><Trash2 size={13} /></button>
                      {isInsightCandidate(m.content) && (
                        <button type="button" onClick={() => depositInsight(m)} title="用自己的话理解了？沉淀到思维宇宙" className="rounded-full bg-island-lavender/20 p-1 text-island-lavender hover:bg-island-lavender hover:text-white"><Brain size={13} /></button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 选中 assistant 文本 → 「追问 / 引用」操作条 */}
      {quoteBtn && (
        <div
          style={{ left: quoteBtn.x - 84, top: quoteBtn.y }}
          className="fixed z-[80] flex items-center gap-0.5 rounded-full border border-island-border bg-island-card/95 p-1 shadow-island backdrop-blur"
        >
          <button
            type="button"
            onClick={() => {
              openSelectionFollowUp(quoteBtn.text, quoteBtn.bubbleText);
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
              if (quoteBtn.text) setQuote(quoteBtn.text);
              setQuoteBtn(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-island-muted transition-colors hover:bg-island-panel hover:text-island-ink"
            title="把选中内容作为引用带入输入框"
          >
            <QuoteIcon size={12} /> 引用
          </button>
        </div>
      )}

      {/* 资源生成快捷栏 */}
      <div className="border-t border-island-border bg-island-panel/40 px-4 py-2">
        <div className="mx-auto max-w-4xl flex flex-wrap items-center justify-center gap-1.5">
          {RESOURCE_ACTIONS.map((a) => {
            const selected = pendingResource === a.type;
            return (
              <button
                key={a.type}
                disabled={busy}
                onClick={() => { setPendingResource(selected ? null : a.type); }}
                className={
                  "inline-flex items-center gap-1 rounded-full border-2 px-3 py-1 text-xs font-bold transition-all duration-200 ease-island disabled:opacity-50 " +
                  (selected
                    ? "bg-island-accent text-white border-island-accent"
                    : "border-island-border bg-island-card text-island-inkSoft hover:-translate-y-px hover:border-island-accent/60 hover:text-island-accentDeep")
                }
                title={selected ? `已选择${a.label}，输入主题后发送` : `使用${a.label}`}
              >
                <a.icon size={13} />
                {a.label}
              </button>
            );
          })}
          {/* 互动刷题入口：逐题作答（区别于一次性生成题库） */}
          <button
            type="button"
            disabled={busy}
            onClick={() => { setQuizMode(!quizMode); setPendingResource(null); }}
            className={
              "inline-flex items-center gap-1 rounded-full border-2 px-3 py-1 text-xs font-bold transition-all duration-200 ease-island disabled:opacity-50 " +
              (quizMode
                ? "bg-island-lavender text-white border-island-lavender"
                : "border-island-border bg-island-card text-island-inkSoft hover:-translate-y-px hover:border-island-lavender/60 hover:text-island-lavender")
            }
            title={quizMode ? "已选择互动刷题，输入想练习的主题后发送" : "互动刷题：一题一题作答、即时批改"}
          >
            <PenLine size={13} />
            刷题练习
          </button>
        </div>
      </div>

      {/* 输入区 — AI coding 风格单卡片容器 */}
      <div className="border-t bg-island-bg px-4 py-3">
        <div className="mx-auto max-w-4xl">
          {quote && (
            <div className="mb-2 flex items-start gap-2 rounded-[16px] border border-island-accent/30 bg-island-accentSoft/60 px-3 py-2 text-xs text-island-ink">
              <QuoteIcon size={13} className="mt-0.5 shrink-0 text-island-accentDeep" />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 font-extrabold text-island-accentDeep">引用内容</div>
                <div className="line-clamp-2 whitespace-pre-wrap text-island-muted">{quote}</div>
              </div>
              <button type="button" onClick={() => setQuote(null)} className="shrink-0 rounded-full p-1 text-island-muted hover:bg-island-card hover:text-island-ink" title="移除引用"><X size={13} /></button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageUpload(f);
              e.target.value = "";
            }}
          />
          <div className="relative overflow-visible rounded-bubble border-2 border-island-border bg-island-card shadow-island transition-all duration-200 ease-island focus-within:border-island-accent focus-within:ring-2 focus-within:ring-island-focus/70">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                pendingImage
                  ? "图片已选择，输入问题后点上传…"
                  : pendingResource
                  ? `已选择${RESOURCE_ACTIONS.find(a => a.type === pendingResource)?.label}，输入主题后按回车生成…`
                  : quizMode
                  ? "已选择「互动刷题」，输入想练习的主题后按回车开始（也可直接回车）…"
                  : "输入问题或学习目标…（Shift+Enter 换行；选中回答文本可引用）"
              }
              rows={3}
              className="min-h-[72px] max-h-52 rounded-none border-0 bg-transparent shadow-none outline-none focus:ring-0 focus-visible:outline-none"
            />
            {/* 底部工具栏：左附件 + 右发送按钮 + 模型名 */}
            <div className="flex items-center justify-between border-t border-island-border bg-island-panel/50 px-3 py-2">
              <button
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-island-muted transition-colors hover:bg-island-card hover:text-island-ink disabled:opacity-50"
                title="上传图片提问（图片理解）"
              >
                <Paperclip size={16} />
              </button>
              <div className="flex items-center gap-2">
                <ReasoningSelector />
                <ModelSelector />
                <button
                  onClick={() => send()}
                  disabled={busy || !input.trim() || !selectedModel}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-island-accent text-white shadow-btn-3d-teal transition-all duration-200 ease-island hover:-translate-y-px hover:bg-island-accentHover hover:shadow-btn-3d-teal-hover active:translate-y-[2px] active:shadow-btn-3d-teal-active disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
                  title="发送"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
      {sideConvId && (
        <SideChatPanel
          conversationId={sideConvId}
          modelKey={sideModelKey}
          onClose={() => { setSideConvId(null); setSideModelKey(undefined); }}
        />
      )}
      <ExploreDock />
    </div>
  );
}
