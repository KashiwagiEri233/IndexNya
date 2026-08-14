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

/**
 * 把普通 Markdown 文本中的术语转换成临时锚点链接。
 * ReactMarkdown v9 不会稳定调用 components.text，所以通过 a renderer 转成按钮。
 */
function decorateTerms(markdown: string, terms: ChatTerm[], onTermClick?: (term: ChatTerm) => void) {
  if (!onTermClick || terms.length === 0) return markdown;
  const validTerms = terms
    .filter((term) => term.text.trim())
    .sort((a, b) => b.text.length - a.text.length);
  if (validTerms.length === 0) return markdown;

  const pattern = new RegExp(validTerms.map((term) => escapeRegExp(term.text)).join("|"), "g");
  const decorateLine = (line: string) => {
    // 保留行内代码，不在代码片段中添加可点击标记。
    const chunks = line.split(/(`+[^`]*`+)/g);
    return chunks.map((chunk, index) => {
      if (index % 2 === 1) return chunk;
      return chunk.replace(pattern, (match) => `[${match}](#term-${encodeURIComponent(match)})`);
    }).join("");
  };

  let fenced = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    return fenced ? line : decorateLine(line);
  }).join("\n");
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
  const decoratedMarkdown = decorateTerms(children, terms, onTermClick);
  return (
    <div className="prose-claude">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
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
        {decoratedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
