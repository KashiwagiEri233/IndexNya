import { useQuery } from "@tanstack/react-query";
import { User, RefreshCw } from "lucide-react";
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
  const student = useAppStore((s) => s.student);
  const profileVersion = useAppStore((s) => s.profileVersion);

  const { data: profile, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["profile", student?.id, profileVersion],
    queryFn: () => (student ? api.getProfile(student.id) : null),
    enabled: !!student,
  });

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
      </div>
    </div>
  );
}
