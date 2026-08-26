import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ClipboardCheck, Trash2, RefreshCw, CheckCircle2, XCircle, HelpCircle, ChevronDown, Loader2,
} from "lucide-react";
import { api, type PracticeRecord } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Badge } from "@/components/ui/badge";
import { RibbonTitle } from "@/components/ui/ribbon";
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
    return { icon: CheckCircle2, label: "答对", cls: "text-island-success bg-island-success/10 border-island-success/30" };
  }
  if (r.is_correct === false) {
    return { icon: XCircle, label: "答错", cls: "text-island-error bg-island-error/10 border-island-error/30" };
  }
  return { icon: HelpCircle, label: "未作答", cls: "text-island-muted bg-island-panel border-island-borderStrong/40" };
}

export default function PracticePage() {
  const practiceVersion = useAppStore((s) => s.practiceVersion);
  const bumpPractice = useAppStore((s) => s.bumpPractice);
  const setPendingPracticeMessage = useAppStore((s) => s.setPendingPracticeMessage);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data: records, isLoading } = useQuery({
    queryKey: ["practice", practiceVersion, filter],
    queryFn: () => api.listPractice(filter),
  });

  const all = useQuery({
    queryKey: ["practice-all", practiceVersion],
    queryFn: () => api.listPractice("all"),
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
    if (!window.confirm("确定清空全部错题记录吗？删除后无法恢复。")) return;
    try {
      await api.clearPractice();
      bumpPractice();
    } catch (error: any) {
      alert(`清空失败：${error.message}`);
    }
  }

  /** 把答错的题目拼成一条消息，带回对话页重新刷一遍。 */
  function repracticeWrong() {
    if (wrongCount === 0) return;
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
        <div className="flex items-center gap-3">
          <RibbonTitle color="yellow" icon={<ClipboardCheck size={14} />}>错题本</RibbonTitle>
          <Badge variant="accent">{items.length} 项</Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={repracticeWrong}
            disabled={wrongCount === 0}
            className="btn-default h-9 px-3.5 text-xs hover:border-island-lavender/60 hover:text-island-lavenderDeep"
            title={wrongCount > 0 ? `重练 ${wrongCount} 道错题` : "还没有答错的题目"}
          >
            <RefreshCw size={13} /> 重练错题{wrongCount > 0 ? `（${wrongCount}）` : ""}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={items.length === 0}
            className="btn-default h-9 px-3.5 text-xs hover:border-island-error/50 hover:text-island-error"
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
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 ease-island",
                filter === f.key ? "bg-island-lavender text-white" : "bg-island-panel text-island-inkSoft hover:-translate-y-px hover:bg-island-card"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-island-muted"><Loader2 size={16} className="animate-spin" /> 加载中…</div>
        ) : items.length === 0 ? (
          <div className="rounded-bubble border-2 border-dashed border-island-borderStrong/40 bg-island-card/60 px-5 py-16 text-center text-island-muted">
            <ClipboardCheck size={40} className="mx-auto mb-3 text-island-lavender/60" />
            <p className="font-extrabold text-island-ink">{filter === "all" ? "还没有刷题记录" : "这个分类下没有题目"}</p>
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
                        {r.topic && <span className="text-[11px] font-bold text-island-muted">{r.topic}</span>}
                      </div>
                      <div className="mt-1.5 whitespace-pre-wrap text-sm font-medium leading-6 text-island-inkSoft">{r.question}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRecord(r)}
                      className="shrink-0 rounded-lg p-1.5 text-island-muted transition-colors hover:bg-island-error/10 hover:text-island-error"
                      title="删除这道题"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {r.options.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {r.options.map((opt, i) => (
                        <li key={i} className="rounded-[12px] bg-island-panel/70 px-2.5 py-1 text-xs text-island-inkSoft">{opt}</li>
                      ))}
                    </ul>
                  )}

                  <details className="mt-2 group">
                    <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-bold text-island-muted transition-colors hover:text-island-accentDeep">
                      <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
                      查看答案与解析
                    </summary>
                    <div className="mt-2 space-y-1.5 rounded-[14px] border border-island-border bg-island-card/80 px-3 py-2 text-xs leading-5 text-island-inkSoft">
                      <div><span className="font-bold text-island-success">答案：</span>{r.answer || "—"}</div>
                      {r.explanation && <div className="text-island-muted">{r.explanation}</div>}
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
