import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import mermaid from "mermaid";
import type { ChatTerm } from "@/lib/api";
import "katex/dist/katex.min.css";
// KaTeX 的 mhchem 扩展，支持 \ce{H2O}、\ce{H2 + O2 -> H2O} 等化学公式。
import "katex/dist/contrib/mhchem.mjs";

mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef(`mmd-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current) return;
      try {
        await mermaid.parse(code);
        const { svg } = await mermaid.render(id.current, code);
        if (!cancelled) ref.current.innerHTML = svg;
      } catch (err: any) {
        // 渲染失败时降级为原始代码块，保证内容可见（并附错误摘要便于理解）
        if (!cancelled && ref.current) {
          const message = String(err?.message || err || "未知错误").slice(0, 120);
          ref.current.innerHTML = `<div class="rounded-xl border border-island-warn/40 bg-island-warn/10 px-3 py-2 text-xs">
            <div class="font-bold text-[#8a6010]">图示渲染失败：${escapeHtml(message)}</div>
            <pre class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[#463729] p-2 text-[12px] text-[#f8f1de]">${escapeHtml(code)}</pre>
          </div>`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);
  return <div ref={ref} className="my-3 overflow-x-auto" />;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// 数学公式归一化
// ============================================================
// 目标：把模型常见的各种 LaTeX 写法统一转换为 remark-math / rehype-katex
// 能识别的 $...$（行内）与 $$...$$（块级，$$ 必须独占一行）。
//
// 处理顺序（每步都先保护已处理片段，避免后续正则误伤）：
//   代码块 → $$...$$ 独立成行 → 多行 $...$ 升级块级 → \[...\] → \(...\)
//   → \ce/\pu → 裸 \begin{env}...\end{env} → 单行 [ ... ] → 保护 $...$
//   → 中文括号 (\alpha) → 保护 → 裸 LaTeX 命令 → 还原

/** 数学命令白名单：命中即视为数学公式（白名单外命令如 \textbf 不误伤）。 */
const MATH_COMMAND_SET = new Set([
  // 分数 / 根式
  "frac", "dfrac", "tfrac", "cfrac", "sqrt",
  // 求和 / 积分 / 极限
  "sum", "prod", "coprod", "int", "iint", "iiint", "iiiint", "oint",
  "lim", "limsup", "liminf", "max", "min", "sup", "inf",
  // 函数名
  "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec", "csc",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "sech", "csch",
  "arg", "deg", "det", "dim", "ker", "Pr", "gcd", "hom", "argmax", "argmin",
  // 希腊字母
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron",
  "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon",
  "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
  // 运算符
  "times", "cdot", "div", "pm", "mp", "ast", "star", "circ", "bullet",
  "oplus", "otimes", "ominus", "oslash", "odot", "dagger", "ddagger", "amalg",
  // 关系符
  "leq", "geq", "neq", "approx", "equiv", "sim", "simeq", "cong", "propto",
  "prec", "succ", "preceq", "succeq", "ll", "gg",
  "subset", "supset", "subseteq", "supseteq", "subsetneq", "cup", "cap",
  "setminus", "emptyset", "varnothing", "in", "notin", "ni",
  "forall", "exists", "nexists",
  "land", "lor", "lnot", "neg", "iff", "implies", "because", "therefore",
  "mid", "nmid", "perp", "parallel", "angle", "triangle", "square", "prime", "top", "bot",
  // 省略号 / 组合
  "ldots", "cdots", "vdots", "ddots", "binom", "choose", "pmod", "bmod", "mod",
  // 微积分 / 向量
  "partial", "nabla", "infty", "aleph", "hbar", "ell", "imath", "jmath", "Re", "Im",
  "vec", "hat", "bar", "tilde", "dot", "ddot",
  "overrightarrow", "overleftarrow", "overline", "underline",
  "overbrace", "underbrace", "overset", "underset", "stackrel",
  // 定界符
  "left", "right", "big", "Big", "bigg", "Bigg", "middle",
  // 箭头
  "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow",
  "Leftrightarrow", "mapsto", "to", "longrightarrow", "longleftarrow",
  "uparrow", "downarrow", "updownarrow",
  // 样式
  "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle",
  "mathrm", "mathbf", "mathit", "mathbb", "mathcal", "mathscr", "mathfrak",
  "mathsf", "mathtt", "boldsymbol", "operatorname", "mbox", "quad", "qquad",
  "tag", "not", "text",
  // 化学（mhchem）
  "ce", "pu",
]);

/** 判断一段文本是否含数学命令（白名单命中）。 */
function looksLikeMath(expr: string): boolean {
  const cmds = expr.match(/\\[A-Za-z]+/g) || [];
  return cmds.some((c) => MATH_COMMAND_SET.has(c.slice(1)));
}

/** 判断字符是否属于数学表达式的一部分（ASCII 字母数字、LaTeX 符号、数学标点）。 */
function isMathChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (ch === "\\" || ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === "(" || ch === ")") return true;
  if (ch === " " || ch === "\t") return true;
  if (code >= 0x30 && code <= 0x39) return true;
  if (code >= 0x41 && code <= 0x5a) return true;
  if (code >= 0x61 && code <= 0x7a) return true;
  if ("=+-^_<>,;:!.*/|~·×÷√∑∫∏∞≈≠≤≥±∈∀∃→←⇒⇔∂∇′″".includes(ch)) return true;
  return false;
}

/**
 * 裸 LaTeX 命令 → 行内公式。
 * 扫描白名单命令（\frac、\sum、\left 等），把命令 + 紧随的数学字符片段包裹成 $...$。
 * 相邻片段自动合并（如 \left( \frac{a}{b} \right) 合并为一个公式）。
 */
function wrapBareLatex(text: string): string {
  const cmdRe = /(^|[^\\])(\\(?:[A-Za-z]+\*?)(?:(?:\{(?:[^{}]|\{[^{}]*\})*\}|\[[^\]]*\])+)?)/g;
  const spans: { start: number; end: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(text)) !== null) {
    const name = (m[2].match(/^\\([A-Za-z]+)/) || [])[1];
    if (!MATH_COMMAND_SET.has(name)) continue;
    let end = cmdRe.lastIndex;
    while (end < text.length && isMathChar(text[end])) end++;
    let start = m.index + m[1].length;
    while (start > 0 && isMathChar(text[start - 1])) start--;
    const candidate = text.slice(start, end).trim();
    if (candidate && looksLikeMath(candidate)) spans.push({ start, end, text: candidate });
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; text: string }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      last.text = text.slice(last.start, last.end).trim();
    } else {
      merged.push({ ...s });
    }
  }
  let out = text;
  for (const s of merged.reverse()) {
    out = out.slice(0, s.start) + `$${s.text}$` + out.slice(s.end);
  }
  return out;
}

/**
 * 裸 \begin{env}...\end{env} → 块级公式（栈式匹配，支持嵌套环境）。
 */
function wrapEnvironments(text: string): string {
  const out: string[] = [];
  let i = 0;
  const beginRe = /\\begin\{([A-Za-z*]+)\}/g;
  while (i < text.length) {
    beginRe.lastIndex = i;
    const bm = beginRe.exec(text);
    if (!bm) {
      out.push(text.slice(i));
      break;
    }
    out.push(text.slice(i, bm.index));
    const env = bm[1];
    const start = bm.index + bm[0].length;
    // 栈式匹配：遇到 begin 入栈，遇到与栈顶匹配的 end 出栈
    const stack = [env];
    const re = /\\begin\{([A-Za-z*]+)\}|\\end\{([A-Za-z*]+)\}/g;
    re.lastIndex = start;
    let endMatch: RegExpExecArray | null = null;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text)) !== null) {
      if (mm[1]) {
        stack.push(mm[1]);
      } else if (mm[2] === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          endMatch = mm;
          break;
        }
      }
    }
    if (!endMatch) {
      out.push(bm[0]);
      i = start;
      continue;
    }
    const body = text.slice(start, endMatch.index);
    out.push(`\n$$\n${bm[0]}${body}${endMatch[0]}\n$$\n`);
    i = endMatch.index + endMatch[0].length;
  }
  return out.join("");
}

function normalizeMathDelimiters(markdown: string) {
  const protectedBlocks: string[] = [];
  const protect = (block: string) => {
    const token = `\u0000MATH${protectedBlocks.length}\u0000`;
    protectedBlocks.push(block);
    return token;
  };

  let normalized = markdown.replace(/```[\s\S]*?```/g, protect);

  // 0. $$...$$ → 独立成行（remark-math 要求 $$ 在行首），并清理内部多余 $
  normalized = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (_m, expr) => `\n$$\n${expr.replace(/\$/g, "").trim()}\n$$\n`);
  normalized = normalized.replace(/\$\$[\s\S]*?\$\$/g, protect);

  // 0.5 多行单 $...$ → 块级公式（模型常输出跨行单美元公式）
  normalized = normalized.replace(/\$([\s\S]*?)\$/g, (m, expr) =>
    expr.includes("\n") ? `\n$$\n${expr.replace(/\$/g, "").trim()}\n$$\n` : m
  );
  normalized = normalized.replace(/\$\$[\s\S]*?\$\$/g, protect);

  // 1. \[ ... \] → 块级公式
  normalized = normalized.replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr) => `\n$$\n${expr.replace(/\$/g, "").trim()}\n$$\n`);
  // 2. \( ... \) → 行内公式
  normalized = normalized.replace(/\\\(([\s\S]*?)\\\)/g, (_m, expr) => `$${expr.replace(/\$/g, "").trim()}$`);
  // 3. \ce{...} / \pu{...} → 行内公式
  normalized = normalized.replace(/(^|[^$\\])\\(ce|pu)\{([^{}\n]+)\}/g, (_m, prefix, command, expr) => `${prefix}$\\${command}{${expr}}$`);

  // 4. 裸 \begin{env}...\end{env} → 块级公式（栈式匹配）
  normalized = wrapEnvironments(normalized);

  // 5. 单行 [ ... ] 含 LaTeX → 块级公式
  normalized = normalized.replace(/(^|\n)([ \t]*)\[([^\n]*\\[A-Za-z][^\n]*)\]([ \t]*)(?=\n|$)/g, (_m, prefix, indent, expr, suffix) =>
    `${prefix}${indent}$$\n${expr.trim()}\n${indent}$$${suffix}`
  );

  // 6. 保护所有 $...$ / $$...$$（避免后续步骤破坏已识别的公式）
  normalized = normalized.replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$/g, protect);

  // 7. 中文文本中的 (\alpha) 等 → 行内公式（排除 \left( \big( 等 LaTeX 定界符）
  normalized = normalized.replace(/(?<![A-Za-z\\])\((?=[^()\n]*\\[A-Za-z])((?:[^()\n]|\([^()\n]*\)[^()\n]*)+)\)/g, (m, expr) => {
    const trimmed = expr.trim();
    return trimmed && looksLikeMath(trimmed) ? `$${trimmed}$` : m;
  });

  // 8. 再次保护（步骤 7 新产生的 $...$）
  normalized = normalized.replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$/g, protect);

  // 9. 裸 LaTeX 命令 → 行内公式
  normalized = wrapBareLatex(normalized);

  // 10. 还原占位符
  normalized = normalized.replace(/\u0000MATH(\d+)\u0000/g, (_m, index) => protectedBlocks[Number(index)]);
  return normalized;
}

/**
 * 在 Markdown AST 的 text 节点中插入 link 节点，再由 a renderer 转成按钮。
 * 直接替换原始 Markdown 文本会破坏 **粗体**、列表和链接语法。
 * 跳过 math / inlineMath 节点，避免术语替换进入 KaTeX 公式内部破坏公式。
 */
function remarkTerms(options: { terms: ChatTerm[] }) {
  const terms = [...(options.terms || [])]
    .filter((term) => term.text.trim())
    .sort((a, b) => b.text.length - a.text.length);
  if (terms.length === 0) return () => undefined;
  const pattern = new RegExp(terms.map((term) => escapeRegExp(term.text)).join("|"), "g");

  return (tree: any) => {
    function walk(node: any) {
      if (!node.children) return;
      if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode" || node.type === "math" || node.type === "inlineMath") return;
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
    <div className="prose-island">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, [remarkTerms as any, { terms }]]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
          code({ inline, className, children: c, ...props }: any) {
            const text = String(c ?? "");
            if (className === "language-mermaid") {
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
                  className="cursor-pointer border-b border-dashed border-island-accent/60 bg-island-accentSoft/40 px-0.5 text-left font-bold text-island-accentDeep transition-colors hover:bg-island-accentSoft"
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
