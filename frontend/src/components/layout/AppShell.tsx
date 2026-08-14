import { NavLink, useNavigate } from "react-router-dom";
import { BookOpen, User, FileText, Map, BarChart3, Sparkles, Plus, MessageSquare, Flower2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const NAV = [
  { to: "/chat", label: "学习对话", icon: Sparkles, tone: "text-island-coral" },
  { to: "/profile", label: "学习画像", icon: User, tone: "text-island-lavender" },
  { to: "/resources", label: "资源岛", icon: FileText, tone: "text-island-sky" },
  { to: "/path", label: "成长路径", icon: Map, tone: "text-island-teal" },
  { to: "/dashboard", label: "学习评估", icon: BarChart3, tone: "text-island-butter" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const student = useAppStore((s) => s.student);
  const studentId = student?.id;
  const convId = useAppStore((s) => s.convId);
  const setConvId = useAppStore((s) => s.setConvId);
  const conversationVersion = useAppStore((s) => s.conversationVersion);
  const navigate = useNavigate();

  const { data: profile } = useQuery({
    queryKey: ["profile", studentId],
    queryFn: () => (studentId ? api.getProfile(studentId) : null),
    enabled: !!studentId,
  });

  const { data: conversations } = useQuery({
    queryKey: ["conversations", studentId, conversationVersion],
    queryFn: () => (studentId ? api.getConversations(studentId) : []),
    enabled: !!studentId,
  });

  function newConversation() {
    setConvId(null);
    navigate("/chat");
  }

  function switchConversation(id: number) {
    setConvId(id);
    navigate("/chat");
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-claude-bg">
      <aside className="relative flex w-[17rem] shrink-0 flex-col overflow-hidden border-r border-claude-border/80 bg-[#f3faf8]">
        <div className="pointer-events-none absolute -right-14 -top-12 h-40 w-40 rounded-full bg-island-mint/45 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-island-peach/55 blur-2xl" />

        <div className="relative px-5 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] bg-claude-accent text-white shadow-island">
              <BookOpen size={21} strokeWidth={2.4} />
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-island-coral text-white">
                <Flower2 size={10} />
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-extrabold tracking-tight text-claude-ink">Index 学习岛</div>
              <div className="mt-1 text-[11px] font-bold text-claude-muted">你的 AI 成长伙伴</div>
            </div>
          </div>
        </div>

        <nav className="relative space-y-1 px-3 pb-4">
          <div className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-claude-muted/70">Explore</div>
          {NAV.map(({ to, label, icon: Icon, tone }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-bold transition-all duration-200",
                  isActive
                    ? "bg-white text-claude-ink shadow-soft"
                    : "text-claude-muted hover:bg-white/75 hover:text-claude-ink"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 transition-colors", isActive && "bg-claude-accentSoft", tone)}>
                    <Icon size={16} strokeWidth={2.4} />
                  </span>
                  <span className="flex-1">{label}</span>
                  <ChevronRight size={14} className={cn("opacity-0 transition-opacity", isActive && "opacity-70")} />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="relative flex min-h-0 flex-1 flex-col border-t border-claude-border/70 px-3 pt-4">
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-claude-muted/70">Recent chats</span>
            <button
              onClick={newConversation}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-claude-muted shadow-soft transition-colors hover:text-claude-accent"
              title="新建对话"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto pb-3">
            {(conversations ?? []).length === 0 && (
              <div className="rounded-2xl border border-dashed border-claude-border bg-white/45 px-3 py-5 text-center text-xs font-semibold text-claude-muted">
                还没有对话，去岛上探索吧
              </div>
            )}
            {(conversations ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => switchConversation(c.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-colors",
                  convId === c.id
                    ? "bg-white text-claude-ink shadow-soft"
                    : "text-claude-muted hover:bg-white/75 hover:text-claude-ink"
                )}
              >
                <MessageSquare size={14} className="shrink-0 text-claude-accent" />
                <span className="truncate">{c.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative m-3 rounded-2xl border border-white bg-white/75 p-3 shadow-soft">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-island-peach text-island-coral"><User size={15} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-extrabold">{student?.name || "新用户"}</div>
              <div className="text-[10px] font-bold text-claude-muted">准备好开始学习了吗？</div>
            </div>
          </div>
          {profile && <div className="mt-2 text-[10px] font-extrabold text-claude-accent">画像版本 v{profile.version}</div>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden bg-claude-bg">{children}</main>
    </div>
  );
}
