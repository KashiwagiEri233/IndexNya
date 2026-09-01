import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Orbit, Brain, Loader2, Trash2, Wand2, Target, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import ForceGraph3D from "react-force-graph-3d";
import { api, type AnchorItem, type UniverseGraph } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RibbonTitle } from "@/components/ui/ribbon";
import { cn } from "@/lib/utils";

interface Verdict {
  approved: boolean;
  score: number;
  feedback: string;
  missing: string[];
}

// animal-island-ui 官方 13 色 NookPhone 标准调色盘
const PALETTE = [
  "#19c8b9", // 薄荷青绿
  "#82d5bb", // 应用青
  "#8ac68a", // 应用绿
  "#d1da49", // 青柠绿
  "#ecdf52", // 黄绿
  "#f7cd67", // 应用黄
  "#e59266", // 应用橙
  "#e18c6f", // 暖桃粉
  "#fc736d", // 应用红
  "#f8a6b2", // 应用粉
  "#b77dee", // 紫色
  "#889df0", // 应用蓝
  "#9a835a", // 棕色
];

export default function UniversePage() {
  const universeVersion = useAppStore((s) => s.universeVersion);
  const bumpUniverse = useAppStore((s) => s.bumpUniverse);
  const pendingInsight = useAppStore((s) => s.pendingInsight);
  const setPendingInsight = useAppStore((s) => s.setPendingInsight);

  const [concept, setConcept] = useState("");
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [anchorTopic, setAnchorTopic] = useState("");
  const [anchorLoading, setAnchorLoading] = useState(false);
  const [anchors, setAnchors] = useState<AnchorItem[]>([]);
  const graphRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });

  // 从对话页带入的候选理解
  useEffect(() => {
    if (pendingInsight) {
      setSummary(pendingInsight.summary);
      if (pendingInsight.concept) setConcept(pendingInsight.concept);
      setPendingInsight(null);
    }
  }, [pendingInsight, setPendingInsight]);

  const { data: understandings } = useQuery({
    queryKey: ["universe", universeVersion],
    queryFn: () => api.getUniverse(),
  });

  const { data: graph } = useQuery({
    queryKey: ["universe-graph", universeVersion],
    queryFn: () => api.getUniverseGraph(),
  });

  useEffect(() => {
    function measure() {
      if (!graphRef.current) return;
      const rect = graphRef.current.getBoundingClientRect();
      setDim({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  async function submit() {
    const c = concept.trim();
    const s = summary.trim();
    if (!c || !s) {
      alert("请填写概念名称和你的理解。");
      return;
    }
    setSubmitting(true);
    setVerdict(null);
    try {
      const result = await api.evaluateUnderstanding({ concept: c, summary: s });
      setVerdict({
        approved: result.approved,
        score: result.score,
        feedback: result.feedback,
        missing: result.missing ?? [],
      });
      if (result.approved) {
        setConcept("");
        setSummary("");
        bumpUniverse();
      }
    } catch (e: any) {
      alert(`评审失败：${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function probeAnchors() {
    if (!anchorTopic.trim()) return;
    setAnchorLoading(true);
    try {
      const result = await api.getAnchors(anchorTopic.trim());
      setAnchors(result.anchors);
    } catch (e: any) {
      alert(`锚点探测失败：${e.message}`);
    } finally {
      setAnchorLoading(false);
    }
  }

  async function removeUnderstanding(id: number, conceptName: string) {
    if (!window.confirm(`确定从思维宇宙中删除「${conceptName}」吗？`)) return;
    try {
      await api.deleteUnderstanding(id);
      bumpUniverse();
    } catch (e: any) {
      alert(`删除失败：${e.message}`);
    }
  }

  const avgScore = useMemo(() => {
    const list = understandings ?? [];
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, u) => sum + u.ai_score, 0) / list.length);
  }, [understandings]);

  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes = graph.nodes.map((n) => ({
      ...n,
      color: PALETTE[(Number(n.id) * 7) % PALETTE.length],
    }));
    const links = graph.links
      .filter((l) => nodeById.has(String(l.source)) && nodeById.has(String(l.target)))
      .map((l) => ({ ...l, source: String(l.source), target: String(l.target) }));
    return { nodes, links };
  }, [graph]);

  const list = understandings ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <header className="island-header">
        <div className="flex items-center gap-3">
          <RibbonTitle color="green" icon={<Orbit size={14} />}>思维宇宙</RibbonTitle>
          <Badge variant="accent">你的理解 · 3D 知识网络</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs font-bold text-island-muted">
          <span>{list.length} 个理解节点</span>
          <span className="text-island-accentDeep">平均分 {avgScore}</span>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 p-5">
        {pendingInsight && (
          <div className="flex items-center gap-2 rounded-[16px] border border-island-lavender/40 bg-island-lavender/10 px-4 py-3 text-xs font-bold text-island-lavenderDeep">
            <Brain size={15} /> 已从对话带入你的原话，补充概念名称后提交评审
          </div>
        )}

        {/* 沉淀你的理解 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Brain size={16} className="text-island-lavender" />
              用自己的话总结一个概念
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="概念名称，如：分治算法"
              className="input"
            />
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              placeholder="用自己的话表达你的理解（不用术语堆砌，像讲给别人听）…"
              className="input resize-none rounded-[18px]"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-island-muted">AI 将从准确性 / 完整性 / 清晰度 / 原创性四个维度评审，认可后存入思维宇宙</span>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || !concept.trim() || !summary.trim()}
                className="btn-accent h-9 px-4 text-xs"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                提交评审
              </button>
            </div>

            {verdict && (
              <div className={cn("rounded-island border-2 px-4 py-3", verdict.approved ? "border-island-success/30 bg-island-success/10" : "border-island-warn/40 bg-island-warn/10")}>
                <div className="flex items-center gap-2">
                  {verdict.approved ? (
                    <CheckCircle2 size={18} className="text-island-success" />
                  ) : (
                    <XCircle size={18} className="text-island-warn" />
                  )}
                  <span className={cn("text-sm font-extrabold", verdict.approved ? "text-island-success" : "text-island-yellowDeep")}>
                    {verdict.approved ? `认可！已存入思维宇宙（${verdict.score} 分）` : `暂未认可（${verdict.score} 分）`}
                  </span>
                </div>
                <p className="mt-2 text-sm text-island-inkSoft">{verdict.feedback}</p>
                {verdict.missing.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-island-muted">
                    {verdict.missing.map((item, i) => (
                      <li key={i}>· {item}</li>
                    ))}
                  </ul>
                )}
                {!verdict.approved && (
                  <button
                    type="button"
                    onClick={() => setVerdict(null)}
                    className="mt-2 rounded-full border-2 border-island-warn/50 bg-island-card px-3 py-1 text-xs font-bold text-island-yellowDeep transition-colors hover:bg-island-warn/20"
                  >
                    修改后重试
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3D 知识网络 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Orbit size={16} className="text-island-accent" />
              3D 知识网络
              <span className="text-[10px] font-bold text-island-muted">拖拽旋转 / 滚轮缩放 / 悬停查看理解</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={graphRef} className="h-[440px] overflow-hidden rounded-island border border-island-border bg-island-content">
              {dim.w > 20 && graphData.nodes.length > 0 ? (
                <ForceGraph
                  width={dim.w}
                  height={dim.h}
                  graphData={graphData}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-island-muted">
                  <Orbit size={36} className="text-island-accent/60" />
                  <p className="text-sm font-semibold">思维宇宙还是空的</p>
                  <p className="text-xs">在上方用你自己的话总结一个概念，认可后它会成为第一颗知识星。</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 锚点探测 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Target size={16} className="text-island-coral" />
              知识锚点探测
              <span className="text-[10px] font-bold text-island-muted">讲解新概念时，AI 会优先调用这些你已掌握的理解</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <input
                value={anchorTopic}
                onChange={(e) => setAnchorTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void probeAnchors(); }}
                placeholder="输入想学的新概念，如：动态规划"
                className="input"
              />
              <button
                type="button"
                onClick={() => void probeAnchors()}
                disabled={anchorLoading || !anchorTopic.trim()}
                className="btn-default h-10 shrink-0 px-4 text-xs"
              >
                {anchorLoading ? <Loader2 size={13} className="animate-spin" /> : "探测"}
              </button>
            </div>
            {anchors.length > 0 && (
              <div className="space-y-2">
                {anchors.map((anchor) => (
                  <div key={anchor.id} className="rounded-[16px] border border-island-accent/30 bg-island-accentSoft/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Sparkles size={12} className="text-island-accentDeep" />
                      <span className="text-sm font-extrabold text-island-ink">{anchor.concept}</span>
                      <span className="ml-auto text-[10px] font-bold text-island-muted">相似度 {(anchor.similarity * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-island-muted">{anchor.summary}</div>
                  </div>
                ))}
              </div>
            )}
            {!anchorLoading && anchorTopic.trim() && anchors.length === 0 && (
              <p className="text-xs text-island-muted">暂无关联锚点——先沉淀几个理解，再回来探测吧。</p>
            )}
          </CardContent>
        </Card>

        {/* 理解列表 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">我的理解库（{list.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <p className="py-4 text-center text-xs text-island-muted">还没有沉淀的理解</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((u) => (
                  <div key={u.id} className="group rounded-[16px] border border-island-border bg-island-card p-3 transition-transform duration-200 ease-island hover:-translate-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-extrabold text-island-ink">{u.concept}</span>
                      <Badge variant="accent">{u.ai_score} 分</Badge>
                      <button
                        type="button"
                        onClick={() => void removeUnderstanding(u.id, u.concept)}
                        className="ml-auto shrink-0 rounded-lg p-1 text-island-muted opacity-0 transition-opacity hover:bg-island-error/10 hover:text-island-error group-hover:opacity-100"
                        title="删除这条理解"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-island-muted">{u.summary}</p>
                    {u.anchors.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {u.anchors.map((a, i) => (
                          <span key={i} className="rounded-full bg-island-panel px-2 py-0.5 text-[10px] font-bold text-island-inkSoft">{a.concept}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** react-force-graph-3d 的轻封装（带类型收敛）。 */
function ForceGraph({ width, height, graphData }: { width: number; height: number; graphData: { nodes: any[]; links: any[] } }) {
  return (
    <ForceGraph3D
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeLabel={(node: any) => `${node.concept}\n${node.summary || ""}`}
      nodeColor={(node: any) => node.color}
      nodeVal={(node: any) => node.size}
      linkWidth={(link: any) => Math.max(0.4, link.weight * 3)}
      linkDirectionalParticles={1}
      linkDirectionalParticleWidth={1.4}
      linkDirectionalParticleSpeed={0.004}
      linkColor={() => "rgba(25,200,185,0.35)"}
      nodeRelSize={5}
    />
  );
}
