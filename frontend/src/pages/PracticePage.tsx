import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ClipboardCheck, Trash2, RefreshCw, CheckCircle2, XCircle, HelpCircle, ChevronDown, Loader2,
} from "lucide-react";
import { api, type PracticeRecord } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "wrong" | "right" | "pending";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "wrong", label: "答错" },
  { key: "right", label: "答对" },
  { key: "pending", label: "未作答" },
];

function statusBadge(r: PracticeRecord) {
  if (r.is_correct === true) {
    return { icon: CheckCircle2, label: "答对", cls: "text-green-600 bg-green-50 border-green-200" };
  }
  if (r.is_correct === false) {
    return { icon: XCircle, label: "答错", cls: "text-red-500 bg-red-50 border-red-200" };
  }
  return { icon: HelpCircle, label: "未作答", cls: "text-claude-muted bg-claude-panel border-claude-border" };
}

export default function PracticePage() {
  const student = useAppStore((s) => s.student);
  const practiceVersion = useAppStore((s) => s.practiceVersion);
  const bumpPractice = useAppStore((s) => s.bumpPractice);
  const setPendingPracticeMessage = useAppStore((s) => s.setPendingPracticeMessage);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data: records, isLoading } = useQuery({
    queryKey: ["practice", student?.id, practiceVersion, filter],
    queryFn: () => (student ? api.listPractice(student.id, filter) : []),
    enabled: !!student,
  });

  const all = useQuery({
    queryKey: ["practice-all", student?.id, practiceVersion],
    queryFn: () => (student ? api.listPractice(student.id, "all") : []),
    enabled: !!student,
  });
  const wrongCount = (all.data ?? []).filter((r) => r.is_correct === false).length;

  async function deleteRecord(record: PracticeRecord) {
    if (!window.confirm(`确定删除这道题吗？\n${record.question.slice(0, 60)}`)) return;
    try {
      await api.deletePractice(record.id);
      bumpPractice();
    } catch (error: any) {
      alert(`删除失败：${error.message}`);
    }
  }

  async function clearAll() {
    if (!student) return;
    if (!window.confirm("确定清空全部错题记录吗？删除后无法恢复。")) return;
    try {
      await api.clearPractice(student.id);
      bumpPractice();
    } catch (error: any) {
      alert(`清空失败：${error.message}`);
    }
  }

  /** 把答错的题目拼成一条消息，带回对话页重新刷一遍。 */
  function repracticeWrong() {
    if (!student || wrongCount === 0) return;
    const wrong = (all.data ?? []).filter((r) => r.is_correct === false);
    const text =
      "重新练习这些错题：\n" +
      wrong.map((r, i) => `${i + 1}. ${r.question}`).join("\n") +
      "\n（先逐题重做，再针对性地讲解我上次答错的原因）";
    setPendingPracticeMessage({ text });
    navigate("/chat");
  }

  const items = records ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <header className="island-header">
        <div className="island-header-title">
          <ClipboardCheck size={18} className="text-island-lavender" />
          <h1 className="font-semibold">错题本</h1>
          <Badge variant="accent">{items.length} 项</Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={repracticeWrong}
            disabled={wrongCount === 0}
            className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-xs font-bold text-claude-muted shadow-soft transition-colors hover:border-island-lavender/50 hover:text-island-lavender disabled:cursor-not-allowed disabled:opacity-40"
            title={wrongCount > 0 ? `重练 ${wrongCount} 道错题` : "还没有答错的题目"}
          >
            <RefreshCw size={13} /> 重练错题{wrongCount > 0 ? `（${wrongCount}）` : ""}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-xs font-bold text-claude-muted shadow-soft transition-colors hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="清空全部错题记录"
          >
            <Trash2 size={13} /> 清空
          </button>
        </div>
      </header>

      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors",
                filter === f.key ? "bg-island-lavender text-white" : "bg-claude-panel text-claude-muted hover:bg-white"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-claude-muted"><Loader2 size={16} className="animate-spin" /> 加载中…</div>
        ) : items.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-claude-border bg-white/50 px-5 py-16 text-center text-claude-muted">
            <ClipboardCheck size={40} className="mx-auto mb-3 text-island-lavender/60" />
            <p className="font-medium text-claude-ink">{filter === "all" ? "还没有刷题记录" : "这个分类下没有题目"}</p>
            <p className="mt-2 text-sm">去对话页说「来几道题刷一刷」，互动刷题中出过的题目会自动收进这里。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
            {items.map((r) => {
              const badge = statusBadge(r);
              const Icon = badge.icon;
              return (
                <div key={r.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", badge.cls)}>
                          <Icon size={11} /> {badge.label}
                        </span>
                        {r.topic && <span className="text-[11px] font-bold text-claude-muted">{r.topic}</span>}
                      </div>
                      <div className="mt-1.5 text-sm font-medium leading-6 text-claude-ink whitespace-pre-wrap">{r.question}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRecord(r)}
                      className="shrink-0 rounded-lg p-1.5 text-claude-muted transition-colors hover:bg-red-50 hover:text-red-500"
                      title="删除这道题"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {r.options.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {r.options.map((opt, i) => (
                        <li key={i} className="rounded-lg bg-claude-panel/60 px-2.5 py-1 text-xs text-claude-ink">{opt}</li>
                      ))}
                    </ul>
                  )}

                  <details className="mt-2 group">
                    <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-bold text-claude-muted transition-colors hover:text-claude-accent">
                      <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
                      查看答案与解析
                    </summary>
                    <div className="mt-2 space-y-1.5 rounded-xl border bg-white/70 px-3 py-2 text-xs leading-5">
                      <div><span className="font-bold text-green-700">答案：</span>{r.answer || "—"}</div>
                      {r.explanation && <div className="text-claude-muted">{r.explanation}</div>}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}