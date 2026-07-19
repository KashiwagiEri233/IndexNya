interface TreeNode {
  title: string;
  children?: TreeNode[];
  markdown_fallback?: string;
}

/** 递归渲染一个节点及其子节点（树状缩进 + 连线）。 */
function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <div className="relative" style={{ marginLeft: depth === 0 ? 0 : 18 }}>
      {depth > 0 && (
        <span
          className="absolute left-[-14px] top-0 h-full w-[10px] border-l border-claude-border"
          aria-hidden
        />
      )}
      <div className="flex items-start gap-1.5 py-1">
        <span className="text-claude-accent mt-0.5 select-none">
          {hasChildren ? "▸" : "•"}
        </span>
        <span className={depth === 0 ? "font-semibold text-base" : depth === 1 ? "font-medium" : ""}>
          {node.title}
        </span>
      </div>
      {hasChildren && (
        <div className="ml-2 border-l border-claude-border/40 pl-0">
          {node.children!.map((child, i) => (
            <Node key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MindmapTree({ tree }: { tree: TreeNode | null | undefined }) {
  if (!tree) return null;
  if (tree.markdown_fallback) {
    return <pre className="text-xs whitespace-pre-wrap">{tree.markdown_fallback}</pre>;
  }
  return (
    <div className="p-3 bg-claude-panel/40 rounded-lg overflow-x-auto">
      <Node node={tree} depth={0} />
    </div>
  );
}
