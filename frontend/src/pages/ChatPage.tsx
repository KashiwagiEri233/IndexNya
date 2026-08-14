import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, FileText, Map as MapIcon, Video, Image as ImageIcon, Presentation, Loader2, Paperclip, Code, ListChecks, BookOpen, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/chat/Markdown";
import { api, type Message } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  route?: { action: string; resource_type?: string; topic?: string };
}

const ROUTE_LABELS: Record<string, string> = {
  lecture: "讲解文档智能体", mindmap: "思维导图智能体", quiz: "题库智能体",
  reading: "拓展阅读智能体", code: "代码实操智能体", video: "教学视频智能体",
  illustration: "教学插图智能体", ppt: "教学PPT智能体",
};

// 快捷栏仅保留 5 个常用入口；其他智能体（题库/拓展阅读/代码/插图/辅导）由路由自动调用
const RESOURCE_ACTIONS = [
  { type: "lecture", label: "讲解文档", icon: FileText },
  { type: "mindmap", label: "思维导图", icon: MapIcon },
  { type: "video", label: "教学视频", icon: Video },
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
  { label: "教学视频", icon: Video },
  { label: "图片生成", icon: ImageIcon },
  { label: "教学PPT", icon: Presentation },
  { label: "图片理解", icon: HelpCircle },
] as const;
export default function ChatPage() {
  const student = useAppStore((s) => s.student);
  const convId = useAppStore((s) => s.convId);
  const setConvId = useAppStore((s) => s.setConvId);
  const bumpResources = useAppStore((s) => s.bumpResources);
  const bumpProfile = useAppStore((s) => s.bumpProfile);
  const bumpPath = useAppStore((s) => s.bumpPath);
  const bumpConversations = useAppStore((s) => s.bumpConversations);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingResource, setPendingResource] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 拉取当前对话的历史消息（convId 变化时）
  useEffect(() => {
    if (!convId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    api.getMessages(convId).then((msgs) => {
      if (cancelled) return;
      setMessages(
        msgs.map((m: any) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
      );
    }).catch(() => setMessages([]));
    return () => { cancelled = true; };
  }, [convId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || busy || !student) return;
    const text = input.trim();
    // 如果选中了某个智能体，走资源生成分支
    if (pendingResource) {
      const type = pendingResource;
      setPendingResource(null);
      setInput("");
      await generateResource(type, text);
      return;
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", streaming: true }]);
    setBusy(true);
    let assistantIdx = -1;
    setMessages((m) => {
      const copy = [...m];
      assistantIdx = copy.length - 1;
      return copy;
    });

    try {
      await api.chatStream(
        { conversation_id: convId ?? undefined, student_id: student.id, message: text },
        {
          onMeta: (d) => {
            if (d.conversation_id) {
              setConvId(d.conversation_id);
              bumpConversations();
            }
          },
          onRoute: (d) => {
            // LLM 自动选择的智能体信息，写入消息 meta 供 UI 显示徽章
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = {
                  ...copy[assistantIdx],
                  route: { action: d.action, resource_type: d.resource_type, topic: d.topic },
                };
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
          onDone: () => {
            setMessages((m) => {
              const copy = [...m];
              if (assistantIdx >= 0 && copy[assistantIdx]) {
                copy[assistantIdx] = { ...copy[assistantIdx], streaming: false };
              }
              return copy;
            });
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
      { role: "assistant", content: "正在调度对应智能体生成资源，请稍候…", streaming: true },
    ]);
    const assistantIdx = messages.length + 1;
    try {
      const r = await api.generateResource({ student_id: student.id, type, topic, conversation_id: convId ?? undefined });
      bumpResources();
      bumpPath();
      let preview = "";
      if (r.type === "video") {
        if (r.file_url) {
          preview = `✅ 已生成教学视频：[查看视频](${r.file_url})`;
        } else {
          preview = `⏳ 数字人视频正在生成中（通常需 2-5 分钟），请到资源库查看进度。`;
        }
      } else if (r.type === "illustration" && r.file_url) {
        preview = `✅ 已生成教学插图：![插图](${r.file_url})`;
      } else if (r.type === "ppt" && r.file_url) {
        preview = `✅ 已生成教学 PPT：[下载 .pptx](${r.file_url})\n\n> PPT 由讯飞智能 PPT v2 API 在线生成，链接有效期 30 天。`;
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

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <header className="island-header">
        <div className="island-header-title">
          <Sparkles size={18} className="text-claude-accent" />
          <h1 className="font-semibold">学习对话</h1>
        </div>
      </header>

      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="island-dot-pattern animate-float-in rounded-[2rem] border border-white bg-white/55 px-5 py-16 text-center text-claude-muted shadow-soft">
              <Sparkles size={40} className="mx-auto mb-3 text-claude-accent" />
              <p className="text-lg font-medium text-claude-ink">你好，我是你的 Index-学习智能助手</p>
              <p className="mt-2 text-sm">聊聊你的专业、目标、薄弱点，我会构建你的学习画像并生成个性化资源。</p>
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
            <div key={i} className={cn("flex gap-3 animate-fade-in", m.role === "user" ? "justify-end" : "")}>
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
                    {m.route && (
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="text-[11px] text-claude-muted">由</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-claude-accentSoft text-claude-accent px-2 py-0.5 text-xs font-medium">
                          {m.route.action === "resource"
                            ? ROUTE_LABELS[m.route.resource_type || ""] || `${m.route.resource_type} 智能体`
                            : m.route.action === "tutor"
                            ? "辅导智能体"
                            : "对话智能体"}
                        </span>
                        <span className="text-[11px] text-claude-muted">回答</span>
                      </div>
                    )}
                    {m.content ? <Markdown>{m.content}</Markdown> : <span className="text-claude-muted">…</span>}
                  </>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                )}
                {m.streaming && <span className="inline-block w-1.5 h-4 ml-1 bg-claude-accent animate-pulse align-middle" />}
              </div>
            </div>
          ))}
        </div>
      </div>
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
                title={selected ? `已选择${a.label}，输入主题后发送` : `选择${a.label}智能体`}
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
          <div className="overflow-hidden rounded-[1.5rem] border border-white bg-white shadow-island focus-within:ring-4 focus-within:ring-claude-accent/15">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                pendingImage
                  ? "图片已选择，输入问题后点上传…"
                  : pendingResource
                  ? `已选择${RESOURCE_ACTIONS.find(a => a.type === pendingResource)?.label} 智能体，输入主题后按回车生成…`
                  : "给 Index-学习智能助手发消息…（Shift+Enter 换行）"
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
                <span className="text-[11px] text-claude-muted px-1.5 py-0.5 rounded bg-claude-panel/60">
                  Spark X2
                </span>
                <button
                  onClick={send}
                  disabled={busy || !input.trim()}
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
  );
}
