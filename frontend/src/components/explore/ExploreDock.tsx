import { useAppStore, type ExploreCardState } from "@/stores/app";
import { ExploreCard } from "@/components/explore/ExploreCard";
import { PanelsTopLeft } from "lucide-react";

/**
 * 探索卡片坞 — 挂在对话/文献页右侧，卡片按深度级联展开，
 * 主线对话始终可见；支持一键「回主线」。
 */
export function ExploreDock() {
  const cards = useAppStore((s) => s.exploreCards);
  const exploreCloseAll = useAppStore((s) => s.exploreCloseAll);

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

  return (
    <>
      <div className="explore-card-in fixed right-5 top-3 z-[95] flex items-center gap-2 rounded-full border border-white bg-white/90 px-3 py-1.5 text-xs font-bold text-claude-muted shadow-island backdrop-blur">
        <PanelsTopLeft size={13} className="text-claude-accent" />
        <span>{cards.length} 张探索卡片</span>
        <button
          type="button"
          onClick={exploreCloseAll}
          className="rounded-full bg-claude-accent px-2.5 py-0.5 text-white transition-colors hover:bg-claude-accentHover"
          title="关闭全部卡片，回到主线"
        >
          回主线
        </button>
      </div>
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
