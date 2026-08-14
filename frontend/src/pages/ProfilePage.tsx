import { useQuery } from "@tanstack/react-query";
import { User, RefreshCw, Orbit, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const DIM_LABELS: Record<string, string> = {
  major: "专业方向",
  knowledge_base: "知识基础",
  cognitive_style: "认知风格",
  common_mistakes: "易错点偏好",
  learning_goals: "学习目标",
  pace_preference: "学习节奏",
  interests: "兴趣领域",
  attention_span: "专注时长",
  summary: "画像总结",
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const student = useAppStore((s) => s.student);
  const profileVersion = useAppStore((s) => s.profileVersion);
  const universeVersion = useAppStore((s) => s.universeVersion);
  const bumpUniverse = useAppStore((s) => s.bumpUniverse);

  const { data: profile, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["profile", student?.id, profileVersion],
    queryFn: () => (student ? api.getProfile(student.id) : null),
    enabled: !!student,
  });

  const { data: understandings } = useQuery({
    queryKey: ["universe", student?.id, universeVersion],
    queryFn: () => (student ? api.getUniverse(student.id) : []),
    enabled: !!student,
  });

  async function removeUnderstanding(id: number, conceptName: string) {
    if (!window.confirm(`确定从思维宇宙中删除「${conceptName}」吗？`)) return;
    try {
      await api.deleteUnderstanding(id);
      bumpUniverse();
    } catch (e: any) {
      alert(`删除失败：${e.message}`);
    }
  }

  if (!student) return <div className="p-8 text-claude-muted">加载中…</div>;

  const dims = profile?.dimensions ?? {};
  const entries = Object.entries(dims).filter(([k]) => k !== "summary");

  return (
    <div className="h-full overflow-y-auto">
      <header className="island-header">
        <div className="island-header-title">
          <User size={18} className="text-claude-accent" />
          <h1 className="font-semibold">学习画像</h1>
          {profile && <Badge variant="accent">v{profile.version}</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          刷新
        </Button>
      </header>

      <div className="p-5 max-w-5xl mx-auto">
        {isLoading ? (
          <div className="text-claude-muted">加载中…</div>
        ) : !profile ? (
          <Card>
            <CardContent className="py-12 text-center">
              <User size={40} className="mx-auto mb-3 text-claude-muted" />
              <p className="font-medium">还没有学习画像</p>
              <p className="mt-2 text-sm text-claude-muted">
                去对话页聊聊你的专业、目标和薄弱点，这里会逐步整理成学习档案。
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {profile.raw_summary && (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle>画像总结</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{profile.raw_summary}</p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {entries.map(([key, val]) => (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{DIM_LABELS[key] ?? key}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-claude-ink whitespace-pre-wrap">
                      {String(val) || "—"}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">画像维度可视化</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {entries.map(([key, val]) => {
                    const len = String(val ?? "").length;
                    const pct = Math.min(100, Math.max(8, (len / 60) * 100));
                    return (
                      <div key={key} className="flex items-center gap-3 text-sm">
                        <div className="w-24 shrink-0 text-claude-muted">{DIM_LABELS[key] ?? key}</div>
                        <div className="flex-1 h-2 rounded-full bg-claude-panel overflow-hidden">
                          <div className="h-full bg-claude-accent" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="w-8 text-right text-xs text-claude-muted">{Math.round(pct)}%</div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-claude-muted">
                  维度信息越完整，画像评分越高（基于信息量估算）。
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {/* 我的理解沉淀（思维宇宙） */}
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Orbit size={15} className="text-island-lavender" />
              我的理解沉淀
              <Badge variant="accent">{understandings?.length ?? 0} 条</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(understandings ?? []).length === 0 ? (
              <p className="py-3 text-center text-xs text-claude-muted">
                还没有沉淀的理解 —— 在对话中用自己的话复述概念，或在思维宇宙中提交。
              </p>
            ) : (
              <div className="space-y-2">
                {(understandings ?? []).slice(0, 5).map((u) => (
                  <div key={u.id} className="group flex items-start gap-2 rounded-xl border border-claude-border/60 bg-white px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-extrabold text-claude-ink">{u.concept}</span>
                        <span className="shrink-0 rounded-full bg-claude-accentSoft px-1.5 py-px text-[10px] font-bold text-claude-accent">{u.ai_score} 分</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-claude-muted">{u.summary}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeUnderstanding(u.id, u.concept)}
                      className="shrink-0 rounded-lg p-1 text-claude-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      title="删除这条理解"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {(understandings ?? []).length > 5 && (
                  <button
                    type="button"
                    onClick={() => navigate("/universe")}
                    className="w-full rounded-xl border border-claude-border/60 bg-white py-2 text-xs font-bold text-claude-muted transition-colors hover:border-claude-accent/40 hover:text-claude-accent"
                  >
                    查看全部 {understandings?.length} 条 → 思维宇宙
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
