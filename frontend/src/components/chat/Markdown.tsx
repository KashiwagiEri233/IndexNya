import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import mermaid from "mermaid";
import type { ChatTerm } from "@/lib/api";
import "katex/dist/katex.min.css";

mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef(`mmd-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current) return;
      try {
        const { svg } = await mermaid.render(id.current, code);
        if (!cancelled) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = `<pre class="text-xs text-red-500">mermaid 语法错误</pre>`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);
  return <div ref={ref} className="my-3 overflow-x-auto" />;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMathDelimiters(markdown: string) {
  let normalized = markdown
    // \[ ... \] → display math
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    // \( ... \) → inline math
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression: string) => `$${expression.trim()}$`);

  // 兼容模型常输出的单行 [ \theta = ... ] 块公式。
  normalized = normalized.replace(/(^|\n)([ \t]*)\[([^\n]*\\[A-Za-z][^\n]*)\]([ \t]*)(?=\n|$)/g, (_match, prefix: string, indent: string, expression: string, suffix: string) => (
    `${prefix}${indent}$$\n${expression.trim()}\n${indent}$$${suffix}`
  ));

  // 兼容中文文本中的 (\alpha)、(\nabla f(\theta)) 等未加分隔符的常见写法。
  normalized = normalized.replace(/\((?=[^()\n]*\\[A-Za-z])((?:[^()\n]|\([^()\n]*\)[^()\n]*)+)\)/g, (_match, expression: string) => `$${expression.trim()}$`);
  return normalized;
}

/**
 * 在 Markdown AST 的 text 节点中插入 link 节点，再由 a renderer 转成按钮。
 * 直接替换原始 Markdown 文本会破坏 **粗体**、列表和链接语法。
 */
function remarkTerms(options: { terms: ChatTerm[] }) {
  const terms = [...(options.terms || [])]
    .filter((term) => term.text.trim())
    .sort((a, b) => b.text.length - a.text.length);
  if (terms.length === 0) return () => undefined;
  const pattern = new RegExp(terms.map((term) => escapeRegExp(term.text)).join("|"), "g");

  return (tree: any) => {
    function walk(node: any) {
      if (!node.children || node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode") return;
      const next: any[] = [];
      for (const child of node.children) {
        if (child.type !== "text") {
          walk(child);
          next.push(child);
          continue;
        }
        let lastIndex = 0;
        let matched = false;
        for (const match of child.value.matchAll(pattern)) {
          const text = match[0];
          const index = match.index ?? 0;
          matched = true;
          if (index > lastIndex) next.push({ type: "text", value: child.value.slice(lastIndex, index) });
          next.push({
            type: "link",
            url: `#term-${encodeURIComponent(text)}`,
            children: [{ type: "text", value: text }],
          });
          lastIndex = index + text.length;
        }
        if (!matched) {
          next.push(child);
        } else if (lastIndex < child.value.length) {
          next.push({ type: "text", value: child.value.slice(lastIndex) });
        }
      }
      node.children = next;
    }
    walk(tree);
  };
}

export function Markdown({
  children,
  terms = [],
  onTermClick,
}: {
  children: string;
  terms?: ChatTerm[];
  onTermClick?: (term: ChatTerm) => void;
}) {
  return (
    <div className="prose-claude">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, [remarkTerms as any, { terms }]]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ inline, className, children: c, ...props }: any) {
            const text = String(c ?? "");
            if (className === "language-mermaid" || text.startsWith("mindmap") || text.startsWith("graph")) {
              return <MermaidBlock code={text} />;
            }
            if (inline) return <code {...props}>{c}</code>;
            return <code {...props}>{c}</code>;
          },
          pre({ children: c }: any) {
            return <pre>{c}</pre>;
          },
          a({ href, children: c }: any) {
            if (href?.startsWith("#term-")) {
              const text = decodeURIComponent(href.slice("#term-".length));
              const term = terms.find((item) => item.text === text) || { text };
              return (
                <button
                  type="button"
                  className="cursor-pointer border-b border-dashed border-claude-accent/70 bg-claude-accentSoft/35 px-0.5 text-left text-claude-accent transition-colors hover:bg-claude-accentSoft hover:text-claude-accentHover"
                  title={`围绕「${text}」继续提问`}
                  onClick={() => onTermClick?.(term)}
                >
                  {c}
                </button>
              );
            }
            return <a href={href} target="_blank" rel="noreferrer">{c}</a>;
          },
        }}
      >
        {normalizeMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
