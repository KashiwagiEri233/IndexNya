import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw, TrendingUp, Lightbulb } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function scoreColor(s: number) {
  if (s >= 80) return "text-green-600";
  if (s >= 60) return "text-amber-600";
  return "text-red-500";
}
function barColor(s: number) {
  if (s >= 80) return "bg-green-500";
  if (s >= 60) return "bg-amber-500";
  return "bg-red-400";
}

export default function DashboardPage() {
  const student = useAppStore((s) => s.student);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["assessment", student?.id],
    queryFn: () => (student ? api.getAssessment(student.id) : null),
    enabled: !!student,
  });

  if (!student) return <div className="p-8 text-claude-muted">加载中…</div>;

  return (
    <div className="h-full overflow-y-auto">
      <header className="island-header">
        <div className="island-header-title">
          <BarChart3 size={18} className="text-claude-accent" />
          <h1 className="font-semibold">学习效果评估</h1>
          <Badge variant="accent">多维度精准评估</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          重新评估
        </Button>
      </header>

      <div className="p-5 max-w-4xl mx-auto">
        {isLoading ? (
          <div className="text-claude-muted">评估中…（首次评估需要先有学习行为数据）</div>
        ) : !data ? (
          <div className="text-claude-muted">暂无数据</div>
        ) : (
          <>
            {/* 总分 */}
            <Card className="mb-4">
              <CardContent className="py-6 text-center">
                <div className="text-xs text-claude-muted mb-1">综合得分</div>
                <div className={cn("text-5xl font-bold", scoreColor(data.total_score ?? 0))}>
                  {data.total_score ?? 0}
                </div>
                <div className="text-xs text-claude-muted mt-1">/ 100</div>
              </CardContent>
            </Card>

            {/* 维度评分 */}
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp size={15} className="text-claude-accent" />
                  多维度评估
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(data.dimensions ?? []).map((d, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{d.name}</span>
                        <span className={cn("text-sm font-bold", scoreColor(d.score))}>{d.score}</span>
                      </div>
                      <div className="h-2 rounded-full bg-claude-panel overflow-hidden">
                        <div className={cn("h-full", barColor(d.score))} style={{ width: `${d.score}%` }} />
                      </div>
                      {d.evidence && (
                        <p className="text-xs text-claude-muted mt-1">{d.evidence}</p>
                      )}
                    </div>
                  ))}
                  {(!data.dimensions || data.dimensions.length === 0) && (
                    <p className="text-sm text-claude-muted">尚无评估维度数据，请先去对话页学习并上报进度。</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 建议 */}
            {data.recommendation && (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lightbulb size={15} className="text-claude-accent" />
                    动态调整建议
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.recommendation}</p>
                </CardContent>
              </Card>
            )}

            {/* 原始统计 */}
            {data.raw_stats && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">原始学习行为数据</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs bg-claude-panel rounded p-3 overflow-x-auto">
                    {JSON.stringify(data.raw_stats, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
