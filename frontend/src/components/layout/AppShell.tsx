import { NavLink, useNavigate } from "react-router-dom";
import { BookOpen, User, FileText, Map, BarChart3, Sparkles, Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const NAV = [
  { to: "/chat", label: "对话", icon: Sparkles },
  { to: "/profile", label: "学习画像", icon: User },
  { to: "/resources", label: "资源库", icon: FileText },
  { to: "/path", label: "学习路径", icon: Map },
  { to: "/dashboard", label: "学习评估", icon: BarChart3 },
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
    <div className="flex h-screen w-screen overflow-hidden">
      {/* 侧栏 */}
      <aside className="w-60 shrink-0 flex flex-col border-r bg-claude-panel">
        <div className="px-4 py-4 flex items-center gap-2 border-b">
          <div className="h-8 w-8 rounded-md bg-claude-accent flex items-center justify-center text-white">
            <BookOpen size={18} />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">Index-学习智能助手</div>
          </div>
        </div>

        <nav className="p-2 space-y-0.5 border-b">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-white text-claude-ink shadow-soft"
                    : "text-claude-muted hover:bg-white/60 hover:text-claude-ink"
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* 对话历史列表 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-claude-muted">对话历史</span>
            <button
              onClick={newConversation}
              className="text-claude-muted hover:text-claude-accent transition-colors"
              title="新建对话"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {(conversations ?? []).length === 0 && (
              <div className="text-xs text-claude-muted px-2 py-3 text-center">
                暂无对话
              </div>
            )}
            {(conversations ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => switchConversation(c.id)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors",
                  convId === c.id
                    ? "bg-white text-claude-ink shadow-soft"
                    : "text-claude-muted hover:bg-white/60 hover:text-claude-ink"
                )}
              >
                <MessageSquare size={13} className="shrink-0" />
                <span className="truncate">{c.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 border-t text-xs text-claude-muted">
          {profile && (
            <div className="mt-1 text-claude-accent">
              画像 v{profile.version}
            </div>
          )}
        </div>
      </aside>

      {/* 主区 */}
      <main className="flex-1 overflow-hidden bg-claude-bg">{children}</main>
    </div>
  );
}
