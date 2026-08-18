import { NavLink, useNavigate } from "react-router-dom";
import { BookOpen, User, FileText, Map as MapIcon, BarChart3, Sparkles, Plus, MessageSquare, Flower2, ChevronRight, GitBranch, Trash2, Settings, ScrollText, Orbit, ArrowUpRight, ArrowRight, ArrowDown, Layers, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { useQuery } from "@tanstack/react-query";
import { api, type CardRow } from "@/lib/api";
import { openExploreCard, restoreExploreCard } from "@/lib/explore";

const NAV = [
  { to: "/chat", label: "学习对话", icon: Sparkles, tone: "text-island-coral" },
  { to: "/practice", label: "错题本", icon: ClipboardCheck, tone: "text-island-lavender" },
  { to: "/literature", label: "文献阅读", icon: ScrollText, tone: "text-island-butter" },
  { to: "/universe", label: "思维宇宙", icon: Orbit, tone: "text-island-lavender" },
  { to: "/profile", label: "学习画像", icon: User, tone: "text-island-teal" },
  { to: "/path", label: "成长路径", icon: MapIcon, tone: "text-island-mint" },
  { to: "/dashboard", label: "学习评估", icon: BarChart3, tone: "text-island-coral" },
];

const CARD_TYPE_META: Record<string, { icon: any; label: string; color: string }> = {
  child: { icon: ArrowUpRight, label: "深挖", color: "text-island-sky" },
  related: { icon: ArrowRight, label: "对比", color: "text-island-coral" },
  branch: { icon: ArrowDown, label: "分支", color: "text-island-lavender" },
};

/** 卡片树行 — 带仓库目录树风格的连线前缀（├─ / └─ / │），用于精准定位层级。 */
interface CardTreeRow {
  card: CardRow;
  prefix: string;
  isLast: boolean;
}
function cardTreeRows(cards: CardRow[]): CardTreeRow[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const childrenOf = new Map<number | null, CardRow[]>();
  for (const c of cards) {
    const pid = c.parent_card_id != null && byId.has(c.parent_card_id) ? c.parent_card_id : null;
    const arr = childrenOf.get(pid) ?? [];
    arr.push(c);
    childrenOf.set(pid, arr);
  }
  const roots = childrenOf.get(null) ?? [];
  const rows: CardTreeRow[] = [];
  function walk(node: CardRow, prefix: string, isLast: boolean) {
    rows.push({ card: node, prefix, isLast });
    const children = childrenOf.get(node.id) ?? [];
    const childPrefix = prefix + (isLast ? "   " : "│  ");
    children.forEach((child, index) => walk(child, childPrefix, index === children.length - 1));
  }
  roots.forEach((root, index) => walk(root, "", index === roots.length - 1));
  return rows;
}

/** 渲染一棵卡片树（对话下 / 文献探索组共用）。 */
function CardTree({
  rows,
  onReopen,
  onDelete,
}: {
  rows: CardTreeRow[];
  onReopen: (card: CardRow) => void;
  onDelete: (card: CardRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {rows.map(({ card, prefix, isLast }) => {
        const meta = CARD_TYPE_META[card.type] ?? CARD_TYPE_META.child;
        const Icon = meta.icon;
        return (
          <div key={card.id} className="group relative flex items-center rounded-xl transition-colors">
            <span className="pointer-events-none absolute -left-2 top-0 h-1/2 w-2 border-l border-b border-claude-border/80" />
            <button
              onClick={() => onReopen(card)}
              className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-1 text-left text-[11px] font-bold text-claude-muted transition-colors hover:bg-white/75 hover:text-claude-ink"
              title={`重开探索卡片「${card.term}」（${meta.label}）`}
            >
              <span className="shrink-0 whitespace-pre font-mono text-[10px] leading-4 text-claude-border">
                {prefix}
                {isLast ? "└─ " : "├─ "}
              </span>
              <Icon size={11} className={cn("shrink-0", meta.color)} />
              <span className="truncate">{card.term}</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(card)}
              className="mr-0.5 shrink-0 rounded-md p-1 text-claude-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
              title="删除探索卡片及其后代"
            >
              <Trash2 size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const student = useAppStore((s) => s.student);
  const studentId = student?.id;
  const convId = useAppStore((s) => s.convId);
  const setConvId = useAppStore((s) => s.setConvId);
  const conversationVersion = useAppStore((s) => s.conversationVersion);
  const cardVersion = useAppStore((s) => s.cardVersion);
  const bumpConversations = useAppStore((s) => s.bumpConversations);
  const bumpCards = useAppStore((s) => s.bumpCards);
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

  const { data: cards } = useQuery({
    queryKey: ["cards", studentId, cardVersion],
    queryFn: () => (studentId ? api.listCards(studentId) : []),
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

  async function deleteConversation(id: number, title: string) {
    if (!window.confirm(`确定删除“${title}”吗？如果它有子对话，子对话也会一并删除。`)) return;
    try {
      const result = await api.deleteConversation(id);
      if (convId != null && result.deleted_ids.includes(convId)) {
        setConvId(null);
        navigate("/chat");
      }
      bumpConversations();
    } catch (error: any) {
      alert(`删除对话失败：${error.message}`);
    }
  }

  function reopenCard(card: CardRow) {
    if (card.conversation_id) {
      setConvId(card.conversation_id);
      navigate("/chat");
    } else {
      navigate("/literature");
    }
    // 已有保存的回复 → 直接恢复显示；否则进入提问编辑态
    if (card.content?.messages?.length) {
      void restoreExploreCard(card);
    } else {
      openExploreCard({
        term: card.term,
        context: card.context,
        mode: card.type,
        conversationId: card.conversation_id ?? undefined,
        parentCardId: card.parent_card_id ?? undefined,
        cardId: card.id,
      });
    }
  }

  async function deleteCard(card: CardRow) {
    if (!window.confirm(`确定删除探索卡片「${card.term}」吗？它的后代卡片${card.branch_conversation_id ? "与分支对话" : ""}会一并删除。`)) return;
    try {
      await api.deleteCard(card.id);
      bumpCards();
    } catch (error: any) {
      alert(`删除卡片失败：${error.message}`);
    }
  }

  const conversationRows: { conversation: (typeof conversations extends (infer Item)[] | undefined ? Item : never); depth: number }[] = [];
  const renderedIds = new Set<number>();
  const allConversations = conversations ?? [];
  const childrenByParent = new Map<number, typeof allConversations>();
  for (const conversation of allConversations) {
    if (conversation.parent_conversation_id != null) {
      const children = childrenByParent.get(conversation.parent_conversation_id) ?? [];
      children.push(conversation);
      childrenByParent.set(conversation.parent_conversation_id, children);
    }
  }

  function appendConversationTree(parentId: number | null, depth: number) {
    const items = parentId == null
      ? allConversations.filter((conversation) => conversation.parent_conversation_id == null)
      : (childrenByParent.get(parentId) ?? []);
    for (const conversation of items) {
      if (renderedIds.has(conversation.id)) continue;
      renderedIds.add(conversation.id);
      conversationRows.push({ conversation, depth });
      appendConversationTree(conversation.id, depth + 1);
    }
  }
  appendConversationTree(null, 0);
  // 防止父会话因数据迁移/删除缺失时，子对话在侧边栏中消失。
  for (const conversation of allConversations) {
    if (!renderedIds.has(conversation.id)) {
      renderedIds.add(conversation.id);
      conversationRows.push({ conversation, depth: 0 });
      appendConversationTree(conversation.id, 1);
    }
  }

  // 探索卡片按来源对话分组；无对话归属的（文献探索）单独成组
  const allCards = cards ?? [];
  const cardsByConversation = new Map<number | null, CardRow[]>();
  for (const card of allCards) {
    const key = card.conversation_id;
    const list = cardsByConversation.get(key) ?? [];
    list.push(card);
    cardsByConversation.set(key, list);
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
              <div className="mt-1 text-[11px] font-bold text-claude-muted">记录、整理、持续进步</div>
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
            {conversationRows.map(({ conversation: c, depth }) => {
              const convCards = cardsByConversation.get(c.id) ?? [];
              return (
                <div key={c.id}>
                  <div
                    style={depth > 0 ? { marginLeft: `${depth * 16}px`, width: `calc(100% - ${depth * 16}px)` } : undefined}
                    className="group relative flex items-center rounded-2xl transition-colors"
                  >
                    {depth > 0 && (
                      <>
                        <span className="pointer-events-none absolute -left-3 top-0 h-1/2 w-3 border-l border-b border-claude-border/90" />
                        <span className="pointer-events-none absolute -left-3 top-1/2 text-[10px] font-bold leading-none text-island-lavender">└─</span>
                      </>
                    )}
                    <button
                      onClick={() => switchConversation(c.id)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left text-sm font-semibold transition-colors",
                        depth > 0 ? "pl-1" : "px-3",
                        convId === c.id
                          ? "bg-white text-claude-ink shadow-soft"
                          : "text-claude-muted hover:bg-white/75 hover:text-claude-ink"
                      )}
                    >
                      {depth > 0 ? (
                        <GitBranch size={13} className="shrink-0 text-island-lavender" />
                      ) : (
                        <MessageSquare size={14} className="shrink-0 text-claude-accent" />
                      )}
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteConversation(c.id, c.title)}
                      className="mr-1 shrink-0 rounded-lg p-1.5 text-claude-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                      title={depth > 0 ? "删除子对话" : "删除对话及其子对话"}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {/* 该对话下的探索卡片树（树状图：├─ / └─ / │ 连线，精准定位层级） */}
                  {convCards.length > 0 && (
                    <div className="mt-0.5" style={{ marginLeft: `${(depth + 1) * 16}px`, width: `calc(100% - ${(depth + 1) * 16}px)` }}>
                      <CardTree rows={cardTreeRows(convCards)} onReopen={reopenCard} onDelete={deleteCard} />
                    </div>
                  )}
                </div>
              );
            })}
            {/* 无对话归属的卡片（文献探索） */}
            {(cardsByConversation.get(null) ?? []).length > 0 && (
              <div className="pt-2">
                <div className="flex items-center gap-1.5 px-3 pb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-claude-muted/70">
                  <Layers size={11} /> 文献探索
                </div>
                <div className="space-y-0.5">
                  <CardTree rows={cardTreeRows(cardsByConversation.get(null) ?? [])} onReopen={reopenCard} onDelete={deleteCard} />
                </div>
              </div>
            )}
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
          <button type="button" onClick={() => navigate("/settings")} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-claude-border/70 bg-white px-2 py-2 text-xs font-bold text-claude-muted transition-colors hover:border-claude-accent/40 hover:bg-claude-accentSoft hover:text-claude-accent" title="打开设置">
            <Settings size={13} /> 设置
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden bg-claude-bg">{children}</main>
    </div>
  );
}
