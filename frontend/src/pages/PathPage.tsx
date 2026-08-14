import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Loader2, ArrowRight, CheckCircle2, Clock, Target } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function PathPage() {
  const student = useAppStore((s) => s.student);
  const pathVersion = useAppStore((s) => s.pathVersion);
  const qc = useQueryClient();
  const [goal, setGoal] = useState("");

  const { data: path, isLoading } = useQuery({
    queryKey: ["path", student?.id, pathVersion],
    queryFn: () => (student ? api.getPath(student.id) : null),
    enabled: !!student,
  });

  const planMut = useMutation({
    mutationFn: () => api.planPath(student!.id, goal),
    onSuccess: (p) => {
      qc.setQueryData(["path", student?.id, pathVersion], p);
      setGoal("");
    },
  });

  return (
    <div className="h-full overflow-y-auto">
      <header className="island-header justify-start gap-2">
        <MapIcon size={18} className="text-claude-accent" />
        <h1 className="font-semibold">学习路径</h1>
        {path && <Badge variant="accent">v{path.version}</Badge>}
      </header>

      <div className="p-5 max-w-4xl mx-auto">
        {/* 生成路径 */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Target size={15} className="text-claude-accent" />
              规划学习路径
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="输入学习目标，如：掌握数据结构基础"
                onKeyDown={(e) => e.key === "Enter" && goal && planMut.mutate()}
                className="flex-1"
              />
              <Button
                onClick={() => planMut.mutate()}
                disabled={!goal || planMut.isPending}
                className="shrink-0 whitespace-nowrap"
              >
                {planMut.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    规划中…
                  </>
                ) : (
                  "生成路径"
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-claude-muted">
              多智能体协同：整合你的画像与已生成资源，规划动态学习节点序列。
            </p>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-claude-muted">加载中…</div>
        ) : !path ? (
          <div className="text-center py-12 text-claude-muted">
            <MapIcon size={40} className="mx-auto mb-3" />
            <p className="font-medium text-claude-ink">还没有学习路径</p>
            <p className="mt-2 text-sm">输入学习目标，让智能体为你规划路径。</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <Target size={14} className="text-claude-accent" />
              <span className="text-claude-muted">目标：</span>
              <span className="font-medium">{path.goal}</span>
            </div>
            <div className="relative pl-6">
              {/* 时间线竖线 */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-claude-border" />
              {path.nodes.map((node, i) => (
                <div key={i} className="relative mb-5 animate-fade-in">
                  {/* 节点圆点 */}
                  <div className="absolute -left-[18px] top-1 h-4 w-4 rounded-full bg-claude-accent border-2 border-white shadow" />
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          步骤 {node.step}：{node.title}
                        </CardTitle>
                        <Badge variant="accent">
                          <Clock size={11} /> {node.estimated_hours ?? 0}h
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-claude-ink mb-2">{node.description}</p>
                      {node.resource_types && node.resource_types.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mb-2">
                          <span className="text-xs text-claude-muted">推荐资源：</span>
                          {node.resource_types.map((t) => (
                            <Badge key={t} variant="default">{t}</Badge>
                          ))}
                          {node.resource_ids && node.resource_ids.length > 0 && (
                            <span className="text-xs text-claude-muted">→ {node.resource_ids.join(", ")}</span>
                          )}
                        </div>
                      )}
                      {node.checkpoint && (
                        <div className="flex items-start gap-1.5 text-xs bg-green-50 border border-green-200 rounded p-2 mt-1">
                          <CheckCircle2 size={13} className="text-green-600 mt-0.5 shrink-0" />
                          <span><span className="font-medium">检查点：</span>{node.checkpoint}</span>
                        </div>
                      )}
                      {node.depends_on && node.depends_on.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-claude-muted mt-1">
                          <ArrowRight size={11} />
                          依赖步骤：{node.depends_on.join(", ")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
