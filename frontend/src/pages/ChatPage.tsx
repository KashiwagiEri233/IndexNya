import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send, Sparkles, FileText, Map as MapIcon, Image as ImageIcon, Presentation, Loader2, Paperclip,
  Code, ListChecks, BookOpen, HelpCircle, PanelRight, GitBranch, X, Pencil, Trash2, Quote as QuoteIcon,
  Brain, Search, ArrowUpRight, ArrowRight, ArrowDown,
} from "lucide-react";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/chat/Markdown";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { ExploreDock } from "@/components/explore/ExploreDock";
import { openExploreCard } from "@/lib/explore";
import { api, type ChatModel, type ChatTerm } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id?: number;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  route?: { action: string; resource_type?: string; topic?: string };
  terms?: ChatTerm[];
  modelId?: string;
  progress?: { phase: string; agent: string; status: string; detail?: string };
  edited?: boolean;
}

const ROUTE_LABELS: Record<string, string> = {
  lecture: "讲解文档", mindmap: "思维导图", quiz: "练习题库",
  reading: "拓展阅读", code: "代码实操",
  illustration: "教学插图", ppt: "教学PPT",
};

// 快捷栏仅保留 5 个常用入口；其他智能体（题库/拓展阅读/代码/插图/辅导）由路由自动调用
const RESOURCE_ACTIONS = [
  { type: "lecture", label: "讲解文档", icon: FileText },
  { type: "mindmap", label: "思维导图", icon: MapIcon },
  { type: "illustration", label: "图片生成", icon: ImageIcon },
  { type: "ppt", label: "教学PPT", icon: Presentation },
] as const;

// 欢迎页展示全部功能（含路由自动调用的智能体）
const ALL_FEATURES = [
  { label: "讲解文档", icon: FileText },
  { label: "思维导图", icon: MapIcon },
  { label: "练习题库", icon: ListChecks },
  { label: "拓展阅读", icon: BookOpen },
  { label: "代码实操", icon: Code },
  { label: "图片生成", icon: ImageIcon },
  { label: "教学PPT", icon: Presentation },
  { label: "图片理解", icon: HelpCircle },
] as const;

function isLocalIllustrationRequest(text: string) {
  return /(?:生成|制作|画|做一张|创建).{0,12}(?:插图|配图|示意图)/.test(text);
}

function isLocalPptRequest(text: string) {
  return /(?:生成|制作|做个|做一份|创建|导出).{0,12}(?:PPT|ppt|幻灯片|演示文稿|课件)/.test(text);
}

function toRequestModel(model: ChatModel | undefined) {
  if (!model) return undefined;
  return {
    id: model.id,
    name: model.name,
    model: model.model,
    base_url: model.baseUrl,
    api_key: model.apiKey,
  };
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

function SideChatPanel({
  conversationId,
  studentId,
  model,
  onClose,
}: {
  conversationId: number;
  studentId: number;
  model?: ChatModel;
  onClose: () => void;
}) {
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
        { conversation_id: conversationId, student_id: studentId, message: text, model: toRequestModel(model), context },
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
            if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], content: `⚠️ ${message}`, streaming: false };
            return next;
          }),
        },
      );
    } catch (error: any) {
      setMessages((current) => {
        const next = [...current];
        if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], content: `⚠️ ${error.message}`, streaming: false };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="relative flex w-[min(430px,42vw)] shrink-0 flex-col border-l border-claude-border/80 bg-[#f8fcfb]">
      <div className="flex min-h-[4.25rem] items-center justify-between border-b border-claude-border/80 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-claude-accentSoft text-claude-accent"><GitBranch size={15} /></div>
          <div className="min-w-0"><div className="truncate text-sm font-extrabold">侧边对话</div><div className="text-[10px] text-claude-muted">基于当前上下文的独立分支</div></div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-claude-muted hover:bg-white hover:text-claude-ink" title="关闭侧边对话"><X size={16} /></button>
      </div>
      <div ref={scrollRef} onMouseUp={handleSelection} onMouseDown={() => setQuoteBtn(null)} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={cn("flex gap-2", message.role === "user" ? "justify-end" : "")}>
              {message.role === "assistant" && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-claude-accent text-white"><Sparkles size={13} /></div>}
              <div className={cn("max-w-[88%] rounded-2xl px-3 py-2 text-sm shadow-soft", message.role === "user" ? "rounded-br-md bg-claude-user" : "rounded-bl-md border bg-white")}>
                {message.role === "assistant" ? (
                  message.content ? (
                    <div data-bubble="assistant">
                      <Markdown terms={message.terms} onTermClick={(term) => onTermClick(term, message.content, message.id)}>{message.content}</Markdown>
                    </div>
                  ) : (
                    <span className="text-claude-muted">…</span>
                  )
                ) : <div className="whitespace-pre-wrap">{message.content}</div>}
                {message.streaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse align-middle bg-claude-accent" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 选中文本 → 「追问 / 引用」操作条 */}
      {quoteBtn && (
        <div
          style={{ left: quoteBtn.x - 84, top: quoteBtn.y }}
          className="fixed z-[80] flex items-center gap-0.5 rounded-full border border-white bg-white/95 p-1 shadow-island backdrop-blur"
        >
          <button
            type="button"
            onClick={() => {
              openSelectionFollowUp(quoteBtn.text, quoteBtn.bubbleText);
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
              if (quoteBtn.text) setQuote(quoteBtn.text);
              setQuoteBtn(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-claude-muted transition-colors hover:bg-claude-panel hover:text-claude-ink"
            title="把选中内容作为引用带入输入框"
          >
            <QuoteIcon size={12} /> 引用
          </button>
        </div>
      )}

      <div className="border-t border-claude-border/70 bg-white/70 p-3">
        {quote && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-claude-accent/30 bg-claude-accentSoft/50 px-2.5 py-1.5 text-xs text-claude-ink">
            <QuoteIcon size={12} className="mt-0.5 shrink-0 text-claude-accent" />
            <div className="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap text-claude-muted">{quote}</div>
            <button type="button" onClick={() => setQuote(null)} className="shrink-0 rounded-full p-0.5 text-claude-muted hover:bg-white hover:text-claude-ink" title="移除引用"><X size={12} /></button>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-white bg-white shadow-soft focus-within:ring-4 focus-within:ring-claude-accent/15">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} placeholder="在侧边分支中继续追问…" className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none" />
          <div className="flex items-center justify-between border-t border-claude-border/60 px-2 py-1.5">
            <span className="max-w-[190px] truncate text-[10px] font-bold text-claude-muted">{model?.name || "未选择模型"}</span>
            <button type="button" onClick={send} disabled={busy || !input.trim()} className="flex h-7 w-7 items-center justify-center rounded-full bg-claude-accent text-white disabled:opacity-40" title="发送">{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function ChatPage() {
  const navigate = useNavigate();
  const student = useAppStore((s) => s.student);
  const convId = useAppStore((s) => s.convId);
  const setConvId = useAppStore((s) => s.setConvId);
  const bumpResources = useAppStore((s) => s.bumpResources);
  const bumpProfile = useAppStore((s) => s.bumpProfile);
  const bumpPath = useAppStore((s) => s.bumpPath);
  const bumpConversations = useAppStore((s) => s.bumpConversations);
  const setPendingInsight = useAppStore((s) => s.setPendingInsight);
  const models = useAppStore((s) => s.models);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const selectedImageModelId = useAppStore((s) => s.selectedImageModelId);
  const selectedModel = models.find((model) => model.id === selectedModelId && model.type !== "image");
  const selectedImageModel = models.find((model) => model.id === selectedImageModelId && model.type === "image");

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingResource, setPendingResource] = useState<string | null>(null);
  const [sideConvId, setSideConvId] = useState<number | null>(null);
  const [sideModel, setSideModel] = useState<ChatModel | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 首条消息创建新会话时，onMeta 会更新 convId；跳过这一次历史拉取，避免覆盖正在流式生成的本地消息。
  const skipHistoryLoadForRef = useRef<number | null>(null);

  // 编辑 / 引用 / 删除状态
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string; bubbleText: string } | null>(null);

  async function refreshMessages(targetConvId: number) {
    try {
      const rows = await api.getMessages(targetConvId);
      setMessages(rows.map((m: any) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
        route: m.meta?.action ? { action: m.meta.action } : undefined,
        terms: Array.isArray(m.meta?.terms) ? m.meta.terms : undefined,
        modelId: m.meta?.model_id || undefined,
        edited: Boolean(m.meta?.edited),
      })));
    } catch {
      /* 静默 */
    }
  }

  // 拉取当前对话的历史消息（convId 变化时）
  useEffect(() => {
    setSideConvId(null);
    setSideModel(undefined);
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
      setMessages(rows.map((m: any) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
        terms: Array.isArray(m.meta?.terms) ? m.meta.terms : undefined,
        modelId: m.meta?.model_id || undefined,
        edited: Boolean(m.meta?.edited),
      })));
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
    if (!student || !text) return;
    const clean = text.replace(/\s+/g, " ").trim();
    openExploreCard({
      term: clean.slice(0, 40),
      context: bubbleText,
      mode: "child",
      conversationId: convId ?? undefined,
    });
  }

  async function send() {
    if (!input.trim() || busy || !student) return;
    const text = input.trim();
    const localPpt = pendingResource === "ppt" || isLocalPptRequest(text);
    const localIllustration = pendingResource === "illustration" || isLocalIllustrationRequest(text);
    if (!selectedModel && !localPpt && !localIllustration) {
      alert("请先添加并选择一个对话模型。");
      return;
    }
    if (localIllustration && !selectedImageModel) {
      alert("请先到设置中添加并选择图片生成模型。");
      return;
    }
    // 如果选中了某个智能体，走资源生成分支
    if (pendingResource) {
      const type = pendingResource;
      setPendingResource(null);
      setInput("");
      await generateResource(type, text);
      return;
    }
    setInput("");
    setQuote(null);
    const context = quote ? `被引用的内容：${quote}` : undefined;
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", streaming: true, modelId: selectedModel?.id }]);
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
          student_id: student.id,
          message: text,
          model: localPpt || localIllustration ? undefined : toRequestModel(selectedModel),
          image_model: localIllustration ? toRequestModel(selectedImageModel) : undefined,
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
                copy[assistantIdx] = { ...copy[assistantIdx], route: { action: d.action, resource_type: d.resource_type, topic: d.topic } };
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
          onProfile: () => bumpProfile(),
          onResource: () => bumpResources(),
          onDone: (d) => {
            setMessages((m) => {
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
                copy[assistantIdx] = { ...copy[assistantIdx], content: `⚠️ ${msg}`, streaming: false };
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
          copy[assistantIdx] = { ...copy[assistantIdx], content: `⚠️ ${e.message}`, streaming: false };
        }
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  async function generateResource(type: string, topic: string) {
    if (!student || !topic.trim()) return;
    topic = topic.trim();
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: `生成【${type}】资源：${topic}` },
      { role: "assistant", content: "正在准备相关内容，请稍候…", streaming: true },
    ]);
    const assistantIdx = messages.length + 1;
    try {
      const r = await api.generateResource({ student_id: student.id, type, topic, conversation_id: convId ?? undefined, model: type === "ppt" || type === "illustration" ? undefined : toRequestModel(selectedModel), image_model: type === "illustration" ? toRequestModel(selectedImageModel) : undefined });
      bumpResources();
      bumpPath();
      let preview = "";
      if (r.type === "illustration" && r.file_url) {
        preview = `✅ 已生成教学插图：![插图](${r.file_url})`;
      } else if (r.type === "ppt" && r.file_url) {
        preview = `✅ 已生成教学 PPT：[下载 .pptx](${r.file_url})\n\n> PPT 由 Index 学习岛本地模板生成。`;
      } else if (r.type === "mindmap" && r.content?.markdown) {
        preview = `✅ 已生成思维导图，[查看可视化树状图](/resources)\n\n${r.content.markdown}`;
      } else if (r.content?.markdown) {
        preview = r.content.markdown;
      } else if (r.content?.mermaid) {
        preview = "```mermaid\n" + r.content.mermaid + "\n```";
      } else if (r.content?.questions) {
        preview = "题库已生成（共 " + r.content.questions.length + " 题），请在资源库查看。";
      } else if (r.content?.error) {
        preview = `⚠️ 生成失败：${r.content.error}`;
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
        copy[assistantIdx] = { role: "assistant", content: `⚠️ 生成失败：${e.message}`, streaming: false };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);

  async function handleImageUpload(file: File) {
    if (!student) return;
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
      const res = await api.understandImage(student.id, file, question);
      let content = res.answer || res.recognition || "（无识别结果）";
      if (res.recognition && res.answer && res.recognition !== res.answer) {
        content = `**识别内容：**\n\n${res.recognition}\n\n---\n\n**针对性解答：**\n\n${res.answer}`;
      }
      if (res.status === "failed") {
        content = `⚠️ 图片理解失败：${res.error}`;
      }
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = { role: "assistant", content, streaming: false };
        return copy;
      });
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = { role: "assistant", content: `⚠️ ${e.message}`, streaming: false };
        return copy;
      });
    } finally {
      setBusy(false);
      setPendingImage(null);
    }
  }

  /** 哪里不懂点哪里 — 点击术语打开探索卡片（先进入提问编辑态）。 */
  function openTerm(term: ChatTerm, context: string, message?: ChatMsg) {
    if (!student) return;
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
    if (!student) return;
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
    const parentModel = models.find((model) => model.id === parentModelId) ?? selectedModel;
    try {
      const branch = await api.branchConversation(convId);
      setSideModel(parentModel);
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
        <div className="island-header-title">
          <Sparkles size={18} className="text-claude-accent" />
          <h1 className="font-semibold">学习对话</h1>
        </div>
        <button type="button" onClick={openSideConversation} disabled={!convId || !!sideConvId} className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-2 text-xs font-bold text-claude-muted shadow-soft transition-colors hover:border-claude-accent/40 hover:text-claude-accent disabled:cursor-not-allowed disabled:opacity-50" title="基于当前对话打开独立侧边分支">
          <PanelRight size={14} /> {sideConvId ? "侧边对话已打开" : "打开侧边对话"}
        </button>
      </header>

      {/* 消息流 */}
      <div ref={scrollRef} onMouseUp={handleSelection} onMouseDown={() => setQuoteBtn(null)} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="island-dot-pattern animate-float-in rounded-[2rem] border border-white bg-white/55 px-5 py-16 text-center text-claude-muted shadow-soft">
              <Sparkles size={40} className="mx-auto mb-3 text-claude-accent" />
              <p className="text-lg font-medium text-claude-ink">开始今天的学习</p>
              <p className="mt-2 text-sm">告诉我正在学什么、想弄清什么，或者直接输入一个学习目标。点击回答中的下划线术语，卡片会在旁边展开。</p>
              <div className="mt-6 grid grid-cols-3 gap-2 max-w-lg mx-auto text-left">
                {ALL_FEATURES.map((a) => (
                  <div key={a.label} className="card p-3 text-sm">
                    <a.icon size={16} className="text-claude-accent mb-1" />
                    <div className="font-medium">{a.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("group relative flex gap-3 animate-fade-in", m.role === "user" ? "justify-end" : "")}>
              {m.role === "assistant" && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-claude-accent text-white shadow-soft">
                  <Sparkles size={16} />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-[1.35rem] px-4 py-3 shadow-soft",
                  m.role === "user"
                    ? "rounded-br-md bg-claude-user text-claude-ink"
                    : "rounded-bl-md border bg-claude-assistant"
                )}
              >
                {m.role === "assistant" ? (
                  <>
                    {m.progress && m.streaming && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-claude-panel/60 px-2 py-1 text-[11px] font-semibold text-claude-muted">
                        <span className={cn("h-1.5 w-1.5 rounded-full", m.progress.status === "failed" ? "bg-red-400" : "bg-claude-accent animate-pulse")} />
                        {m.progress.detail || `${m.progress.agent} 正在工作…`}
                      </div>
                    )}
                    {m.route && (
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="text-[11px] text-claude-muted">由</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-claude-accentSoft text-claude-accent px-2 py-0.5 text-xs font-medium">
                          {m.route.action === "resource"
                            ? ROUTE_LABELS[m.route.resource_type || ""] || `${m.route.resource_type}`
                            : m.route.action === "tutor"
                            ? "辅导回答"
                            : "学习问答"}
                        </span>
                        <span className="text-[11px] text-claude-muted">回答</span>
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
                      </div>
                    ) : <span className="text-claude-muted">…</span>}
                  </>
                ) : editingId === m.id ? (
                  <div className="w-[min(520px,60vw)]">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full resize-none rounded-xl border border-claude-accent/50 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-claude-accent/15"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-full border px-3 py-1 text-xs font-bold text-claude-muted hover:bg-white">取消</button>
                      <button type="button" onClick={() => m.id && saveEdit(m.id)} className="rounded-full bg-claude-accent px-3 py-1 text-xs font-bold text-white hover:bg-claude-accentHover">保存</button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}{m.edited && <span className="ml-1 text-[10px] text-claude-muted">(已编辑)</span>}</div>
                )}
                {m.streaming && <span className="inline-block w-1.5 h-4 ml-1 bg-claude-accent animate-pulse align-middle" />}
              </div>

              {/* 悬浮操作：assistant → 深挖/发散/分支/删除；user → 编辑/删除/沉淀
                  放在气泡外侧空白区（assistant 右侧 / user 左侧），避免遮挡气泡内的可点击术语 */}
              {!m.streaming && (
                <div
                  className="absolute top-0 z-10 flex items-center gap-0.5 rounded-full border border-white bg-white/95 px-1 py-0.5 opacity-0 shadow-soft transition-opacity group-hover:opacity-100"
                  style={m.role === "user" ? { left: 0 } : { right: 0 }}
                >
                  {m.role === "assistant" ? (
                    <>
                      <button type="button" onClick={() => openExploreFromMessage(m, "child")} title="深挖这段内容的背景知识" className="rounded-full p-1 text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent"><ArrowUpRight size={13} /></button>
                      <button type="button" onClick={() => openExploreFromMessage(m, "related")} title="横向对比发散" className="rounded-full p-1 text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent"><ArrowRight size={13} /></button>
                      <button type="button" onClick={() => openExploreFromMessage(m, "branch")} title="继承上下文另起分支" className="rounded-full p-1 text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent"><ArrowDown size={13} /></button>
                      <span className="mx-0.5 h-3 w-px bg-claude-border/70" />
                      <button type="button" onClick={() => deleteRound(m, i)} title="删除这一轮" className="rounded-full p-1 text-claude-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditingId(m.id ?? null); setEditText(m.content); }} title="编辑这条消息" className="rounded-full p-1 text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent"><Pencil size={13} /></button>
                      <button type="button" onClick={() => deleteRound(m, i)} title="删除这一轮" className="rounded-full p-1 text-claude-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
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
          className="fixed z-[80] flex items-center gap-0.5 rounded-full border border-white bg-white/95 p-1 shadow-island backdrop-blur"
        >
          <button
            type="button"
            onClick={() => {
              openSelectionFollowUp(quoteBtn.text, quoteBtn.bubbleText);
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
              if (quoteBtn.text) setQuote(quoteBtn.text);
              setQuoteBtn(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-claude-muted transition-colors hover:bg-claude-panel hover:text-claude-ink"
            title="把选中内容作为引用带入输入框"
          >
            <QuoteIcon size={12} /> 引用
          </button>
        </div>
      )}

      {/* 资源生成快捷栏 */}
      <div className="border-t bg-claude-panel/50 px-4 py-2">
        <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-center gap-1.5">
          {RESOURCE_ACTIONS.map((a) => {
            const selected = pendingResource === a.type;
            return (
              <button
                key={a.type}
                disabled={busy}
                onClick={() => setPendingResource(selected ? null : a.type)}
                className={
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 " +
                  (selected
                    ? "bg-claude-accent text-white border-claude-accent"
                    : "bg-white hover:bg-claude-accentSoft hover:border-claude-accent/40")
                }
                title={selected ? `已选择${a.label}，输入主题后发送` : `使用${a.label}`}
              >
                <a.icon size={13} />
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 输入区 — AI coding 风格单卡片容器 */}
      <div className="border-t bg-claude-bg px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {quote && (
            <div className="mb-2 flex items-start gap-2 rounded-2xl border border-claude-accent/30 bg-claude-accentSoft/50 px-3 py-2 text-xs text-claude-ink">
              <QuoteIcon size={13} className="mt-0.5 shrink-0 text-claude-accent" />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 font-extrabold text-claude-accent">引用内容</div>
                <div className="line-clamp-2 whitespace-pre-wrap text-claude-muted">{quote}</div>
              </div>
              <button type="button" onClick={() => setQuote(null)} className="shrink-0 rounded-full p-1 text-claude-muted hover:bg-white hover:text-claude-ink" title="移除引用"><X size={13} /></button>
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
          <div className="relative overflow-visible rounded-[1.5rem] border border-white bg-white shadow-island focus-within:ring-4 focus-within:ring-claude-accent/15">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                pendingImage
                  ? "图片已选择，输入问题后点上传…"
                  : pendingResource
                  ? `已选择${RESOURCE_ACTIONS.find(a => a.type === pendingResource)?.label}，输入主题后按回车生成…`
                  : "输入问题或学习目标…（Shift+Enter 换行；选中回答文本可引用）"
              }
              rows={2}
              className="border-0 shadow-none focus:ring-0 rounded-none min-h-[48px] max-h-40 bg-transparent"
            />
            {/* 底部工具栏：左附件 + 右发送按钮 + 模型名 */}
            <div className="flex items-center justify-between border-t border-claude-border/60 bg-claude-panel/35 px-3 py-2">
              <button
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-claude-muted hover:bg-claude-panel hover:text-claude-ink transition-colors disabled:opacity-50"
                title="上传图片提问（图片理解）"
              >
                <Paperclip size={16} />
              </button>
              <div className="flex items-center gap-2">
                <ModelSelector />
                <button
                  onClick={send}
                  disabled={busy || !input.trim() || !selectedModel}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-claude-accent text-white shadow-soft transition-all hover:-translate-y-0.5 hover:bg-claude-accentHover disabled:pointer-events-none disabled:opacity-40"
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
      {sideConvId && student && (
        <SideChatPanel
          conversationId={sideConvId}
          studentId={student.id}
          model={sideModel}
          onClose={() => { setSideConvId(null); setSideModel(undefined); }}
        />
      )}
      <ExploreDock />
    </div>
  );
}
