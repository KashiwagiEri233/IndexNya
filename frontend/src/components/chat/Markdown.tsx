import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import mermaid from "mermaid";
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

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-claude">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ inline, className, children: c, ...props }: any) {
            const text = String(c ?? "");
            // mermaid 代码块
            if (className === "language-mermaid" || text.startsWith("mindmap") || text.startsWith("graph")) {
              return <MermaidBlock code={text} />;
            }
            if (inline) {
              return <code {...props}>{c}</code>;
            }
            return <code {...props}>{c}</code>;
          },
          pre({ children }: any) {
            return <pre>{children}</pre>;
          },
          a({ href, children: c }: any) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {c}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
