import { useEffect, useRef, useState } from "react";
import { GitBranch, Loader2, Send, X } from "lucide-react";
import { Markdown } from "@/components/chat/Markdown";
import { api, type ChatModel, type ChatTerm } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TermMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function toRequestModel(model?: ChatModel) {
  if (!model) return undefined;
  return {
    id: model.id,
    name: model.name,
    model: model.model,
    base_url: model.baseUrl,
    api_key: model.apiKey,
  };
}

export function TermConversationPopover({
  term,
  conversationId,
  studentId,
  context,
  model,
  onClose,
}: {
  term: ChatTerm;
  conversationId: number;
  studentId: number;
  context: string;
  model?: ChatModel;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<TermMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const explanationStarted = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!model || explanationStarted.current) return;
    explanationStarted.current = true;
    void generateExplanation();
  }, [conversationId, model?.id]);

  function updateAssistant(index: number, update: (message: TermMessage) => TermMessage) {
    setMessages((current) => {
      const next = [...current];
      if (next[index]) next[index] = update(next[index]);
      return next;
    });
  }

  async function generateExplanation() {
    if (!model) return;
    const assistantIndex = 0;
    setMessages([{ role: "assistant", content: "", streaming: true }]);
    setBusy(true);
    try {
      await api.chatStream(
        {
          conversation_id: conversationId,
          student_id: studentId,
          message: `请现在就为学生完整讲解“${term.text}”。请先给出清晰定义，再说明它为什么重要、如何工作，并提供一个简单例子或应用场景。不要反问，直接开始讲解。`,
          model: toRequestModel(model),
          context: `当前专有名词：${term.text}\n已有简要解释：${term.explanation || "请结合上下文解释。"}\n相关回答：${context.slice(0, 4000)}`,
        },
        {
          onToken: (token) => updateAssistant(assistantIndex, (message) => ({ ...message, content: message.content + token })),
          onDone: () => updateAssistant(assistantIndex, (message) => ({ ...message, streaming: false })),
          onError: (message) => updateAssistant(assistantIndex, (current) => ({ ...current, content: `⚠️ ${message}`, streaming: false })),
        },
      );
    } catch (error: any) {
      updateAssistant(assistantIndex, (message) => ({ ...message, content: `⚠️ ${error.message}`, streaming: false }));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!model) {
      alert("请先在主对话底部添加并选择一个模型。");
      return;
    }
    setInput("");
    const assistantIndex = messages.length + 1;
    setMessages((current) => [
      ...current,
      { role: "user", content: text },
      { role: "assistant", content: "", streaming: true },
    ]);
    setBusy(true);
    try {
      await api.chatStream(
        {
          conversation_id: conversationId,
          student_id: studentId,
          message: text,
          model: toRequestModel(model),
          context: `当前专有名词：${term.text}\n专有名词解释：${term.explanation || "请结合上下文解释。"}\n相关回答：${context.slice(0, 4000)}`,
        },
        {
          onToken: (token) => setMessages((current) => {
            const next = [...current];
            if (next[assistantIndex]) next[assistantIndex] = { ...next[assistantIndex], content: next[assistantIndex].content + token };
            return next;
          }),
          onDone: () => setMessages((current) => {
            const next = [...current];
            if (next[assistantIndex]) next[assistantIndex] = { ...next[assistantIndex], streaming: false };
            return next;
          }),
          onError: (message) => setMessages((current) => {
            const next = [...current];
            if (next[assistantIndex]) next[assistantIndex] = { ...next[assistantIndex], content: `⚠️ ${message}`, streaming: false };
            return next;
          }),
        },
      );
    } catch (error: any) {
      setMessages((current) => {
        const next = [...current];
        if (next[assistantIndex]) next[assistantIndex] = { ...next[assistantIndex], content: `⚠️ ${error.message}`, streaming: false };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="fixed bottom-5 right-5 z-50 flex max-h-[min(680px,calc(100vh-2.5rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.5rem] border border-white bg-[#f8fcfb] shadow-island">
      <header className="flex items-center justify-between border-b border-claude-border/70 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-claude-accentSoft text-claude-accent"><GitBranch size={15} /></div>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-claude-ink">围绕「{term.text}」继续提问</div>
            <div className="truncate text-[10px] text-claude-muted">独立子对话 · {model?.name || "未选择模型"}</div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-claude-muted hover:bg-claude-panel hover:text-claude-ink" title="关闭子对话"><X size={16} /></button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="rounded-2xl border border-claude-accent/20 bg-claude-accentSoft/55 px-3 py-2.5 text-xs leading-5 text-claude-ink">
          <div className="mb-1 font-extrabold">{term.text}</div>
          <div>{term.explanation || "你可以继续询问它的定义、例子、应用或与其他概念的区别。"}</div>
        </div>
        <div className="mt-3 space-y-3">
          {messages.length === 0 && !busy && <div className="px-2 py-5 text-center text-xs text-claude-muted">输入问题，开始围绕这个概念深入学习。</div>}
          {messages.map((message, index) => (
            <div key={index} className={cn("flex gap-2", message.role === "user" ? "justify-end" : "")}>
              <div className={cn("max-w-[88%] rounded-2xl px-3 py-2 text-sm shadow-soft", message.role === "user" ? "rounded-br-md bg-claude-user" : "rounded-bl-md border bg-white")}>
                {message.role === "assistant" ? (message.content ? <Markdown>{message.content}</Markdown> : <span className="text-claude-muted">…</span>) : <div className="whitespace-pre-wrap">{message.content}</div>}
                {message.streaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse align-middle bg-claude-accent" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-claude-border/70 bg-white/75 p-3">
        <div className="overflow-hidden rounded-2xl border border-white bg-white shadow-soft focus-within:ring-4 focus-within:ring-claude-accent/15">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} disabled={busy} placeholder={busy ? "正在生成专有名词讲解…" : "围绕这个专有名词继续追问…"} className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none" />
          <div className="flex items-center justify-between border-t border-claude-border/60 px-2 py-1.5">
            <span className="max-w-[240px] truncate text-[10px] font-bold text-claude-muted">{model?.name || "未选择模型"}</span>
            <button type="button" onClick={send} disabled={busy || !input.trim() || !model} className="flex h-7 w-7 items-center justify-center rounded-full bg-claude-accent text-white disabled:opacity-40" title="发送">{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
