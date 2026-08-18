import { useState } from "react";
import { useAppStore, type ExploreCardState } from "@/stores/app";
import { ExploreCard } from "@/components/explore/ExploreCard";
import { ArrowDown, ArrowRight, ArrowUpRight, ListTree, PanelsTopLeft, X } from "lucide-react";
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

  const MODE_ICON: Record<string, { icon: typeof ArrowUpRight; cls: string }> = {
    child: { icon: ArrowUpRight, cls: "text-[#4358c0]" },
    related: { icon: ArrowRight, cls: "text-[#a05a28]" },
    branch: { icon: ArrowDown, cls: "text-[#7a3fd0]" },
  };
  const STATUS_DOT: Record<string, string> = {
    pending: "bg-island-faint",
    opening: "bg-island-sky animate-pulse",
    streaming: "bg-island-accent animate-pulse",
    done: "bg-island-seafoam",
    error: "bg-island-error",
  };

  return (
    <>
      <div className="explore-card-in fixed right-5 top-3 z-[95] flex items-center gap-2 rounded-full border border-island-border bg-island-card/90 px-3 py-1.5 text-xs font-bold text-island-muted shadow-island backdrop-blur">
        <PanelsTopLeft size={13} className="text-island-accentDeep" />
        <span>{cards.length} 张探索卡片</span>
        <button
          type="button"
          onClick={() => setTreeOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors",
            treeOpen ? "bg-island-lavender text-white" : "bg-island-panel text-island-muted hover:bg-island-lavender/20 hover:text-island-lavender"
          )}
          title={treeOpen ? "收起卡片树" : "展开卡片树（树状定位）"}
        >
          <ListTree size={13} />
          卡片树
        </button>
        <button
          type="button"
          onClick={exploreCloseAll}
          className="rounded-full bg-island-accent px-2.5 py-0.5 text-white transition-all duration-200 ease-island hover:-translate-y-px hover:bg-island-accentHover"
          title="关闭全部卡片，回到主线"
        >
          回主线
        </button>
      </div>

      {/* 卡片树面板 — 仓库目录树风格 */}
      {treeOpen && (
        <div className="explore-card-in fixed left-4 top-[4.5rem] z-[120] flex max-h-[70vh] w-[19rem] flex-col overflow-hidden rounded-[1.25rem] border border-island-border bg-island-content/95 shadow-island backdrop-blur">
          <div className="flex items-center justify-between border-b border-island-border bg-island-card/80 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-island-ink">
              <ListTree size={13} className="text-island-lavender" />
              探索卡片树
            </div>
            <button
              type="button"
              onClick={() => setTreeOpen(false)}
              className="rounded-full p-1 text-island-muted hover:bg-island-panel hover:text-island-ink"
              title="收起"
            >
              <X size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="flex items-center gap-2 rounded-[12px] bg-island-card/80 p-1.5 text-[10px] font-bold leading-4 text-island-muted">
              <span className="inline-flex items-center gap-0.5"><ArrowUpRight size={10} className="text-[#4358c0]" /> 深挖</span>
              <span className="inline-flex items-center gap-0.5"><ArrowRight size={10} className="text-[#a05a28]" /> 对比</span>
              <span className="inline-flex items-center gap-0.5"><ArrowDown size={10} className="text-[#7a3fd0]" /> 分支</span>
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
                      active ? "bg-island-accentSoft ring-2 ring-island-accent/40" : "hover:bg-island-card"
                    )}
                    title={`定位卡片「${c.term}」`}
                  >
                    <span className="shrink-0 whitespace-pre font-mono text-[10px] leading-4 text-island-borderStrong/70">
                      {row.prefix}
                      {row.isLast ? "└─ " : "├─ "}
                    </span>
                    {(() => {
                      const ModeIcon = (MODE_ICON[c.mode] ?? MODE_ICON.child).icon;
                      return <ModeIcon size={11} strokeWidth={2.6} className={cn("shrink-0", (MODE_ICON[c.mode] ?? MODE_ICON.child).cls)} />;
                    })()}
                    <span className={cn("min-w-0 flex-1 truncate text-[11px] font-bold", active ? "text-island-accent" : "text-island-ink")}>
                      {c.term}
                    </span>
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[c.status] ?? "bg-island-faint")} title={c.status} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        exploreClose(c.key);
                      }}
                      className="shrink-0 rounded-md p-0.5 text-island-muted opacity-0 transition-opacity hover:bg-island-error/10 hover:text-island-error group-hover:opacity-100"
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
