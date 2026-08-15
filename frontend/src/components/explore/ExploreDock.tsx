import { useState } from "react";
import { useAppStore, type ExploreCardState } from "@/stores/app";
import { ExploreCard } from "@/components/explore/ExploreCard";
import { ListTree, PanelsTopLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 探索卡片坞 — 挂在对话/文献页右侧，卡片按深度级联展开，
 * 主线对话始终可见；支持一键「回主线」。
 *
 * 卡片树面板：以仓库目录树风格（├─ / └─ / │）呈现所有打开卡片的层级结构，
 * 点击任意节点即可精准定位（高亮置顶）对应卡片。
 */
export function ExploreDock() {
  const cards = useAppStore((s) => s.exploreCards);
  const exploreCloseAll = useAppStore((s) => s.exploreCloseAll);
  const exploreClose = useAppStore((s) => s.exploreClose);
  const exploreFocus = useAppStore((s) => s.exploreFocus);
  const focusCardKey = useAppStore((s) => s.focusCardKey);
  const [treeOpen, setTreeOpen] = useState(false);

  if (cards.length === 0) return null;

  const byKey = new Map(cards.map((c) => [c.key, c]));

  function chainOf(key: string): ExploreCardState[] {
    const chain: ExploreCardState[] = [];
    let current = byKey.get(key);
    while (current) {
      chain.unshift(current);
      current = current.parentKey ? byKey.get(current.parentKey) : undefined;
    }
    return chain;
  }

  // —— 卡片树：按 parentKey 组织为森林，输出带树形连线的扁平行 ——
  interface TreeRow {
    card: ExploreCardState;
    prefix: string;
    isLast: boolean;
  }
  function buildTreeRows(): TreeRow[] {
    const childrenOf = new Map<string, ExploreCardState[]>();
    for (const c of cards) {
      if (c.parentKey && byKey.has(c.parentKey)) {
        const arr = childrenOf.get(c.parentKey) ?? [];
        arr.push(c);
        childrenOf.set(c.parentKey, arr);
      }
    }
    const roots = cards.filter((c) => !(c.parentKey && byKey.has(c.parentKey)));
    const rows: TreeRow[] = [];
    function walk(node: ExploreCardState, prefix: string, isLast: boolean) {
      rows.push({ card: node, prefix, isLast });
      const children = childrenOf.get(node.key) ?? [];
      const childPrefix = prefix + (isLast ? "   " : "│  ");
      children.forEach((child, index) => walk(child, childPrefix, index === children.length - 1));
    }
    roots.forEach((root, index) => walk(root, "", index === roots.length - 1));
    return rows;
  }

  const treeRows = buildTreeRows();

  const MODE_ICON: Record<string, string> = { child: "↗️", related: "➡️", branch: "⬇️" };
  const STATUS_DOT: Record<string, string> = {
    pending: "bg-claude-border",
    opening: "bg-island-sky animate-pulse",
    streaming: "bg-claude-accent animate-pulse",
    done: "bg-island-mint",
    error: "bg-red-400",
  };

  return (
    <>
      <div className="explore-card-in fixed right-5 top-3 z-[95] flex items-center gap-2 rounded-full border border-white bg-white/90 px-3 py-1.5 text-xs font-bold text-claude-muted shadow-island backdrop-blur">
        <PanelsTopLeft size={13} className="text-claude-accent" />
        <span>{cards.length} 张探索卡片</span>
        <button
          type="button"
          onClick={() => setTreeOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors",
            treeOpen ? "bg-island-lavender text-white" : "bg-claude-panel text-claude-muted hover:bg-island-lavender/20 hover:text-island-lavender"
          )}
          title={treeOpen ? "收起卡片树" : "展开卡片树（树状定位）"}
        >
          <ListTree size={13} />
          卡片树
        </button>
        <button
          type="button"
          onClick={exploreCloseAll}
          className="rounded-full bg-claude-accent px-2.5 py-0.5 text-white transition-colors hover:bg-claude-accentHover"
          title="关闭全部卡片，回到主线"
        >
          回主线
        </button>
      </div>

      {/* 卡片树面板 — 仓库目录树风格 */}
      {treeOpen && (
        <div className="explore-card-in fixed left-4 top-[4.5rem] z-[120] flex max-h-[70vh] w-[19rem] flex-col overflow-hidden rounded-[1.25rem] border border-white bg-[#f8fcfb]/95 shadow-island backdrop-blur">
          <div className="flex items-center justify-between border-b border-claude-border/70 bg-white/80 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-claude-ink">
              <ListTree size={13} className="text-island-lavender" />
              探索卡片树
            </div>
            <button
              type="button"
              onClick={() => setTreeOpen(false)}
              className="rounded-full p-1 text-claude-muted hover:bg-claude-panel hover:text-claude-ink"
              title="收起"
            >
              <X size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="rounded-xl bg-white/70 p-1.5 text-[10px] font-bold leading-4 text-claude-muted">
              <span className="font-mono">├─</span> 子卡片（深挖）　<span className="font-mono">➡️</span> 关联（对比）　<span className="font-mono">⬇️</span> 分支
            </div>
            <div className="mt-1.5 space-y-px">
              {treeRows.map((row) => {
                const c = row.card;
                const active = focusCardKey === c.key;
                return (
                  <div
                    key={c.key}
                    onClick={() => exploreFocus(c.key)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors",
                      active ? "bg-claude-accentSoft ring-2 ring-claude-accent/40" : "hover:bg-white"
                    )}
                    title={`定位卡片「${c.term}」`}
                  >
                    <span className="shrink-0 whitespace-pre font-mono text-[10px] leading-4 text-claude-border">
                      {row.prefix}
                      {row.isLast ? "└─ " : "├─ "}
                    </span>
                    <span className="shrink-0 text-[10px] leading-4">{MODE_ICON[c.mode] ?? "↗️"}</span>
                    <span className={cn("min-w-0 flex-1 truncate text-[11px] font-bold", active ? "text-claude-accent" : "text-claude-ink")}>
                      {c.term}
                    </span>
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[c.status] ?? "bg-claude-border")} title={c.status} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        exploreClose(c.key);
                      }}
                      className="shrink-0 rounded-md p-0.5 text-claude-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      title="关闭这张卡片"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {cards.map((card) => {
        const chain = chainOf(card.key);
        return (
          <ExploreCard
            key={card.key}
            card={card}
            depth={chain.length - 1}
            breadcrumb={chain.slice(0, -1).map((c) => c.term)}
          />
        );
      })}
    </>
  );
}
