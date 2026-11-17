import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sparkles,
} from "lucide-react";
import { api, type DailyProblem, type DailyProblemSummary, type DailySource } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { RibbonTitle } from "@/components/ui/ribbon";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

const SOURCES: { key: DailySource; label: string; short: string }[] = [
  { key: "leetcode", label: "力扣 LeetCode", short: "力扣" },
  { key: "nowcoder", label: "牛客竞赛", short: "牛客" },
];

const LANGUAGES: { key: string; label: string }[] = [
  { key: "cpp", label: "C++" },
  { key: "java", label: "Java" },
  { key: "python3", label: "Python3" },
  { key: "javascript", label: "JavaScript" },
];

const NOWCODER_TEMPLATES: Record<string, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // 在此编写代码

    return 0;
}
`,
  java: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // 在此编写代码
    }
}
`,
  python3: `import sys


def main() -> None:
    data = sys.stdin.read().split()
    # 在此编写代码


if __name__ == "__main__":
    main()
`,
  javascript: `const input = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);
// 在此编写代码
`,
};

const LEETCODE_TEMPLATES: Record<string, string> = {
  cpp: `class Solution {
public:
    // 在此编写代码

};
`,
  java: `class Solution {
    // 在此编写代码

}
`,
  python3: `class Solution:
    def solve(self):
        # 在此编写代码
        pass
`,
  javascript: `/**
 * @return {void}
 */
var solve = function () {
    // 在此编写代码

};
`,
};

/** 常见算法/数据结构知识点词表：命中的文本会加下划线，可点击提问 AI。 */
const KNOWLEDGE_TERMS = [
  "动态规划", "状态转移方程", "状态压缩", "记忆化搜索", "贪心", "二分查找", "二分答案",
  "双指针", "滑动窗口", "前缀和", "差分数组", "单调栈", "单调队列", "哈希表",
  "链表", "二叉树", "二叉搜索树", "平衡二叉树", "优先队列", "栈", "队列",
  "深度优先搜索", "广度优先搜索", "拓扑排序", "并查集", "字典树", "线段树", "树状数组",
  "最小生成树", "最短路", "归并排序", "快速排序", "递归", "回溯", "分治", "位运算",
  "字符串匹配", "KMP", "数论", "质数", "最大公约数", "最小公倍数", "组合数学",
  "排列组合", "容斥原理", "矩阵快速幂", "快速幂", "区间DP", "树形DP", "状态机",
  "子序列", "子数组", "子串", "时间复杂度", "空间复杂度", "数组", "字符串", "矩阵", "区间",
  "dynamic programming", "greedy", "binary search", "two pointers", "sliding window",
  "hash table", "linked list", "binary tree", "priority queue", "stack", "queue",
  "graph", "depth-first search", "breadth-first search", "topological sort", "union find",
  "trie", "segment tree", "binary indexed tree", "shortest path", "recursion",
  "backtracking", "divide and conquer", "bit manipulation", "prefix sum", "subsequence",
  "subarray", "substring", "time complexity", "space complexity", "array", "string", "matrix",
  "memoization", "monotonic stack", "monotonic queue", "merge sort", "quick sort",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在文本中查找互不重叠的知识点命中（同起点优先长词）。 */
function findTermMatches(text: string, terms: string[]): Array<{ start: number; end: number }> {
  const hits: Array<{ start: number; end: number }> = [];
  const lower = text.toLowerCase();
  for (const term of terms) {
    if (/^[\x20-\x7e]+$/.test(term)) {
      const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        hits.push({ start: match.index, end: match.index + match[0].length });
        if (!match[0].length) pattern.lastIndex += 1;
      }
    } else {
      let index = lower.indexOf(term.toLowerCase());
      while (index >= 0) {
        hits.push({ start: index, end: index + term.length });
        index = lower.indexOf(term.toLowerCase(), index + term.length);
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const result: Array<{ start: number; end: number }> = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start < lastEnd) continue;
    result.push(hit);
    lastEnd = hit.end;
  }
  return result;
}

/** 把题目富文本中的知识点包成可点击下划线（跳过代码块与链接）。 */
function annotateKnowledgeTerms(html: string, rawTerms: string[]): string {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const terms = Array.from(new Set(rawTerms.map((term) => term.trim()).filter((term) => term.length >= 2)));
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent || parent.closest("pre, code, a, button")) continue;
      const text = node.nodeValue ?? "";
      if (text.trim().length < 2) continue;
      const matches = findTermMatches(text, terms);
      if (!matches.length) continue;
      const fragment = doc.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        if (match.start > cursor) fragment.appendChild(doc.createTextNode(text.slice(cursor, match.start)));
        const span = doc.createElement("span");
        const term = text.slice(match.start, match.end);
        span.className = "knowledge-term";
        span.setAttribute("data-knowledge-term", term);
        span.setAttribute("role", "button");
        span.setAttribute("tabindex", "0");
        span.setAttribute("title", `点击向 AI 提问「${term}」`);
        span.textContent = term;
        fragment.appendChild(span);
        cursor = match.end;
      }
      if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.slice(cursor)));
      parent.replaceChild(fragment, node);
    }
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

function difficultyTone(difficulty: string): "success" | "warn" | "error" | "default" {
  if (difficulty === "简单") return "success";
  if (difficulty === "中等") return "warn";
  if (difficulty === "困难") return "error";
  return "default";
}

function starterCode(problem: DailyProblem | undefined, language: string): string {
  if (!problem) return "";
  const snippet = problem.codeSnippets?.find((item) => item.langSlug === language);
  if (snippet?.code) return snippet.code;
  if (problem.source === "nowcoder") return NOWCODER_TEMPLATES[language] ?? "";
  return LEETCODE_TEMPLATES[language] ?? "";
}

/** 过滤题目富文本中的脚本与事件属性，保留可读的排版标签。 */
function sanitizeProblemHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc
      .querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, textarea, button, noscript")
      .forEach((node) => node.remove());
    doc.querySelectorAll("*").forEach((element) => {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "style" || name === "class" || name === "id") {
          element.removeAttribute(attribute.name);
        }
      }
      if (element.tagName === "A") {
        const href = element.getAttribute("href") || "";
        if (!/^https?:/i.test(href)) element.removeAttribute("href");
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noreferrer noopener");
      }
    });
    return doc.body.innerHTML;
  } catch {
    return "";
  }
}

function draftStorageKey(problem: DailyProblem, language: string): string {
  return `indexnya:daily-draft:${problem.source}:${problem.id}:${language}`;
}

function loadLanguage(): string {
  const stored = localStorage.getItem("indexnya:daily-language");
  return LANGUAGES.some((item) => item.key === stored) ? stored! : "cpp";
}

export default function DailyPage() {
  const navigate = useNavigate();
  const setPendingChatPrompt = useAppStore((s) => s.setPendingChatPrompt);
  const [source, setSource] = useState<DailySource>("leetcode");
  const [selected, setSelected] = useState<{ id?: string; slug?: string } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [recommendTick, setRecommendTick] = useState(0);
  const [language, setLanguage] = useState<string>(loadLanguage);
  const [code, setCode] = useState("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const gutterRef = useRef<HTMLDivElement>(null);

  const { data: problem, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["daily-problem", source, selected?.id ?? "", selected?.slug ?? "", refreshTick],
    queryFn: () =>
      api.getDailyProblem({
        source,
        id: selected?.id,
        slug: selected?.slug,
        refresh: refreshTick > 0,
      }),
    retry: 0,
  });

  const problemKey = problem ? `${problem.source}:${problem.id}` : "";
  const tagSlugs = useMemo(() => (problem?.tags ?? []).map((tag) => tag.slug), [problem]);
  const annotatedHtml = useMemo(() => {
    const base = sanitizeProblemHtml(problem?.contentHtml ?? "");
    const tagNames = (problem?.tags ?? []).map((tag) => tag.name);
    return annotateKnowledgeTerms(base, [...tagNames, ...KNOWLEDGE_TERMS]);
  }, [problem?.contentHtml, problem?.tags]);

  const { data: recommendations, isFetching: recommendLoading } = useQuery({
    queryKey: ["daily-recommend", source, problemKey, recommendTick, tagSlugs.join(",")],
    queryFn: () =>
      api.getDailyRecommendations({
        source,
        tags: tagSlugs,
        exclude: problem?.id,
        limit: 4,
      }),
    enabled: Boolean(problem),
    retry: 0,
  });

  // 切换题目/语言时载入本地草稿或官方模板
  useEffect(() => {
    if (!problem) return;
    const saved = localStorage.getItem(draftStorageKey(problem, language));
    setCode(saved ?? starterCode(problem, language));
    setSavedHint(saved ? "已恢复本地草稿" : null);
  }, [problem?.source, problem?.id, language]);

  function switchSource(next: DailySource) {
    if (next === source) return;
    setSource(next);
    setSelected(null);
    setRefreshTick(0);
    setRecommendTick(0);
  }

  function refreshDaily() {
    setSelected(null);
    setRefreshTick((value) => value + 1);
  }

  function switchLanguage(next: string) {
    setLanguage(next);
    localStorage.setItem("indexnya:daily-language", next);
  }

  function handleCodeChange(next: string) {
    setCode(next);
    if (!problem) return;
    localStorage.setItem(draftStorageKey(problem, language), next);
    setSavedHint("草稿已自动保存");
  }

  function resetTemplate() {
    if (!problem) return;
    localStorage.removeItem(draftStorageKey(problem, language));
    setCode(starterCode(problem, language));
    setSavedHint("已恢复初始模板");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("复制失败，请手动选中代码复制。");
    }
  }

  function handleTab(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${code.slice(0, start)}    ${code.slice(end)}`;
    handleCodeChange(next);
    window.requestAnimationFrame(() => {
      target.selectionStart = start + 4;
      target.selectionEnd = start + 4;
    });
  }

  function loadRecommendation(item: DailyProblemSummary) {
    setSelected({ id: item.id, slug: item.slug });
    setRefreshTick(0);
  }

  /** 点击划线知识点：带上题目上下文，跳转学习对话并自动提问。 */
  function askAboutTerm(term: string) {
    if (!problem) return;
    const plain = problem.contentHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);
    const prompt = [
      `我正在做每日一题《${problem.title}》（${problem.difficulty} · ${problem.source === "leetcode" ? "力扣" : "牛客"}）。`,
      `请给我讲解知识点「${term}」：`,
      "1. 它是什么，核心思想与适用场景；",
      "2. 为什么这道题会用到它；",
      "3. 结合这道题给出清晰的解题思路（必要时给出关键代码）。",
      plain ? `\n题目描述（节选）：${plain}` : "",
      problem.url ? `题目链接：${problem.url}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    setPendingChatPrompt({ text: prompt });
    navigate("/chat");
  }

  function handleContentClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-knowledge-term]");
    const term = target?.dataset.knowledgeTerm;
    if (term) askAboutTerm(term);
  }

  function handleContentKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-knowledge-term]");
    const term = target?.dataset.knowledgeTerm;
    if (!term) return;
    event.preventDefault();
    askAboutTerm(term);
  }

  const lines = code.split("\n");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="island-header">
        <div className="flex items-center gap-3">
          <RibbonTitle color="orange" icon={<CalendarDays size={14} />}>
            每日一题
          </RibbonTitle>
          <Badge variant="accent">{problem?.date ?? "今天"}</Badge>
          {isFetching && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-island-muted">
              <Loader2 size={12} className="animate-spin" /> 抓取中…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-island-panel p-1">
            {SOURCES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => switchSource(item.key)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-all duration-200 ease-island",
                  source === item.key
                    ? "bg-island-orange text-white shadow-soft"
                    : "text-island-inkSoft hover:bg-island-card"
                )}
                title={item.label}
              >
                {item.short}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refreshDaily}
            disabled={isFetching}
            className="btn-default h-9 px-3.5 text-xs"
            title="重新抓取今天的题目"
          >
            <RefreshCw size={13} className={cn(isFetching && "animate-spin")} /> 刷新
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-5">
        <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          {/* 题目区 */}
          <section className="card flex h-[70vh] min-h-0 flex-col overflow-hidden lg:h-full">
            <div className="border-b border-island-border px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={difficultyTone(problem?.difficulty ?? "未知")} variant="soft">
                  {problem?.difficulty ?? "未知"}
                </Badge>
                <Badge variant="outlined">{source === "leetcode" ? "力扣" : "牛客"}</Badge>
                {problem?.id && <span className="text-[11px] font-bold text-island-muted">#{problem.id}</span>}
                {problem?.offline && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-island-error">
                    <AlertTriangle size={11} /> 离线兜底
                  </span>
                )}
                {problem?.stale && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-island-yellowDeep">
                    <AlertTriangle size={11} /> 本地缓存
                  </span>
                )}
              </div>
              <h1 className="mt-2 text-lg font-extrabold leading-7 text-island-ink">
                {problem?.title ?? (isLoading ? "正在获取每日一题…" : "暂无题目")}
              </h1>
              {problem?.subtitle && (
                <div className="mt-0.5 text-xs font-bold text-island-muted">{problem.subtitle}</div>
              )}
              {problem?.tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {problem.tags.map((tag) => (
                    <span key={tag.slug} className="chip text-[11px]">
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {problem && !error && (
                <div className="mt-2 text-[10px] font-bold text-island-muted">
                  划线知识点可直接点击 → 去学习对话提问 AI
                </div>
              )}
              {problem?.note && (
                <div className="mt-2 rounded-[12px] bg-island-warn/15 px-3 py-2 text-[11px] font-bold leading-5 text-island-yellowDeep">
                  {problem.note}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {error ? (
                <div className="rounded-bubble border-2 border-dashed border-island-error/40 bg-island-error/5 px-5 py-10 text-center text-sm text-island-inkSoft">
                  <AlertTriangle size={32} className="mx-auto mb-2 text-island-error/70" />
                  <p className="font-extrabold text-island-ink">题目获取失败</p>
                  <p className="mt-1 text-xs">{(error as Error).message}</p>
                  <button type="button" onClick={() => refetch()} className="btn-default mt-3 h-9 px-4 text-xs">
                    <RefreshCw size={13} /> 重试
                  </button>
                </div>
              ) : isLoading ? (
                <div className="flex items-center gap-2 text-sm text-island-muted">
                  <Loader2 size={16} className="animate-spin" /> 正在抓取题目…
                </div>
              ) : (
                <div
                  className="prose-island max-w-none [&_img]:mx-auto [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg [&_pre]:whitespace-pre-wrap"
                  onClick={handleContentClick}
                  onKeyDown={handleContentKeyDown}
                  dangerouslySetInnerHTML={{ __html: annotatedHtml }}
                />
              )}

              {problem?.url && (
                <a
                  href={problem.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-island-accentDeep underline decoration-island-accent/40 underline-offset-2"
                >
                  <ExternalLink size={12} /> 在源站打开原题
                </a>
              )}

              {/* 标签随机推荐 */}
              <div className="mt-6 border-t border-island-border pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-island-muted">
                    <Sparkles size={12} /> 同标签随机推荐
                  </div>
                  <button
                    type="button"
                    onClick={() => setRecommendTick((value) => value + 1)}
                    disabled={!problem || recommendLoading}
                    className="inline-flex items-center gap-1 rounded-full bg-island-panel px-3 py-1 text-[11px] font-bold text-island-inkSoft transition-colors hover:bg-island-card disabled:opacity-50"
                  >
                    <Shuffle size={11} className={cn(recommendLoading && "animate-spin")} /> 换一批
                  </button>
                </div>
                {recommendLoading ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-island-muted">
                    <Loader2 size={13} className="animate-spin" /> 正在挑选题目…
                  </div>
                ) : recommendations?.items?.length ? (
                  <div className="mt-3 space-y-2">
                    {recommendations.items.map((item) => (
                      <button
                        key={`${item.source}-${item.id}`}
                        type="button"
                        onClick={() => loadRecommendation(item)}
                        className="flex w-full items-center gap-2 rounded-[14px] border border-island-border bg-island-panel/60 px-3 py-2 text-left transition-all duration-200 ease-island hover:-translate-y-px hover:border-island-accent/50 hover:bg-island-card"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-island-ink">{item.title}</span>
                          <span className="mt-0.5 block truncate text-[10px] font-semibold text-island-muted">
                            #{item.id} · {item.tags.map((tag) => tag.name).join(" / ") || "未标注标签"}
                          </span>
                        </span>
                        <Badge color={difficultyTone(item.difficulty)} variant="soft" className="shrink-0">
                          {item.difficulty}
                        </Badge>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-island-muted">
                    {recommendations?.note ?? "暂无推荐，点「换一批」再试试。"}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* 简易 IDE */}
          <section className="card flex h-[70vh] min-h-0 flex-col overflow-hidden lg:h-full">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-island-border px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm font-extrabold text-island-ink">
                <Code2 size={15} className="text-island-accentDeep" /> 简易编辑器
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {LANGUAGES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => switchLanguage(item.key)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-200 ease-island",
                      language === item.key
                        ? "bg-island-accentSoft text-island-accentDeep"
                        : "text-island-muted hover:bg-island-panel hover:text-island-inkSoft"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-island-border px-5 py-2">
              <span className="text-[11px] font-bold text-island-muted">
                {savedHint ?? "代码只保存在本机浏览器"}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={resetTemplate}
                  disabled={!problem}
                  className="inline-flex items-center gap-1 rounded-full bg-island-panel px-2.5 py-1 text-[11px] font-bold text-island-inkSoft transition-colors hover:bg-island-card disabled:opacity-50"
                  title="恢复到当前语言的初始模板"
                >
                  <RotateCcw size={11} /> 重置
                </button>
                <button
                  type="button"
                  onClick={copyCode}
                  className="inline-flex items-center gap-1 rounded-full bg-island-panel px-2.5 py-1 text-[11px] font-bold text-island-inkSoft transition-colors hover:bg-island-card"
                >
                  {copied ? <Check size={11} className="text-island-success" /> : <Copy size={11} />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="flex min-h-0 flex-1 overflow-hidden rounded-[14px] border border-island-border bg-island-codeBg shadow-soft">
                <div
                  ref={gutterRef}
                  aria-hidden="true"
                  className="w-11 shrink-0 select-none overflow-hidden border-r border-white/10 py-3 pr-2 text-right font-mono text-xs leading-6 text-island-codeInk/35"
                >
                  {lines.map((_, index) => (
                    <div key={index}>{index + 1}</div>
                  ))}
                </div>
                <textarea
                  value={code}
                  onChange={(event) => handleCodeChange(event.target.value)}
                  onKeyDown={handleTab}
                  onScroll={(event) => {
                    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                  }}
                  spellCheck={false}
                  placeholder="选择题目后，这里会自动带入起始模板…"
                  className="min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-3 font-mono text-[13px] leading-6 text-island-codeInk outline-none placeholder:text-island-codeInk/30"
                />
              </div>
              <div className="mt-2 flex items-center justify-between px-1 text-[10px] font-bold text-island-muted">
                <span>{LANGUAGES.find((item) => item.key === language)?.label} · 本地简易编辑器（不联网判题）</span>
                <span>{lines.length} 行</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
