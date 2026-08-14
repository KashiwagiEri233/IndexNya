import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Video, Image as ImageIcon, Code, ListChecks, BookOpen, Map as MapIcon, Loader2, CheckCircle2, XCircle, Presentation, Download, ExternalLink } from "lucide-react";
import { api, type Resource } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { MindmapTree } from "@/components/resources/MindmapTree";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/chat/Markdown";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  lecture: { label: "讲解文档", icon: FileText, color: "text-blue-600" },
  mindmap: { label: "思维导图", icon: MapIcon, color: "text-purple-600" },
  quiz: { label: "练习题库", icon: ListChecks, color: "text-green-600" },
  reading: { label: "拓展阅读", icon: BookOpen, color: "text-amber-600" },
  code: { label: "代码实操", icon: Code, color: "text-cyan-600" },
  video: { label: "教学视频", icon: Video, color: "text-red-600" },
  illustration: { label: "教学插图", icon: ImageIcon, color: "text-pink-600" },
  ppt: { label: "教学PPT", icon: Presentation, color: "text-orange-600" },
};

const FILTERS = ["all", "lecture", "mindmap", "quiz", "reading", "code", "video", "illustration", "ppt"];

function ResourceCard({ r }: { r: Resource }) {
  const meta = TYPE_META[r.type] ?? { label: r.type, icon: FileText, color: "" };
  const Icon = meta.icon;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={18} className={cn("shrink-0", meta.color)} />
            <CardTitle className="text-sm truncate">{r.title}</CardTitle>
          </div>
          {r.status === "completed" ? (
            <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          ) : r.status === "failed" ? (
            <XCircle size={16} className="text-red-500 shrink-0" />
          ) : (
            <Loader2 size={16} className="animate-spin shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="accent">{meta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-[480px] overflow-y-auto pr-1">
          <ResourceBody r={r} />
        </div>
      </CardContent>
    </Card>
  );
}

function VideoBody({ r }: { r: Resource }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(r.file_url);
  const [status, setStatus] = useState<string>(r.status);

  useEffect(() => {
    if (videoUrl || status !== "processing") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.videoStatus(r.id);
        if (cancelled) return;
        if (res.status === "completed" && res.video_url) {
          setVideoUrl(res.video_url);
          setStatus("completed");
        } else if (res.status === "failed") {
          setStatus("failed");
        }
      } catch {
        // 忽略，下次重试
      }
    };
    poll();
    const t = setInterval(poll, 10000); // 10 秒轮询一次
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [r.id, videoUrl, status]);

  if (status === "failed") {
    return <p className="text-sm text-red-500">视频生成失败</p>;
  }
  if (videoUrl) {
    return <video src={videoUrl} controls className="w-full rounded-md max-h-80" />;
  }
  return (
    <div className="text-sm text-claude-muted flex items-center gap-2 py-4">
      <Loader2 size={16} className="animate-spin" />
      数字人视频生成中（通常需 2-5 分钟），请稍候…
    </div>
  );
}

function ResourceBody({ r }: { r: Resource }) {
  if (r.status === "failed") {
    return <p className="text-sm text-red-500">生成失败：{r.content?.error ?? "未知错误"}</p>;
  }
  if (r.status === "processing") {
    return <p className="text-sm text-claude-muted">生成中…</p>;
  }
  if (r.type === "video") {
    return <VideoBody r={r} />;
  }
  if (r.type === "illustration" && r.file_url) {
    return <img src={r.file_url} alt={r.title} className="w-full rounded-md max-h-80 object-contain" />;
  }
  if (r.type === "ppt" && r.file_url) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Presentation size={20} className="text-orange-600" />
          <span className="text-sm font-medium">讯飞智能 PPT（在线生成）</span>
        </div>
        <div className="flex items-center gap-2">
          <a href={r.file_url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 rounded-md bg-claude-accent text-white px-3 py-1.5 text-sm hover:bg-claude-accentHover">
            <Download size={14} />
            下载 .pptx
          </a>
          <a href={r.file_url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-claude-panel">
            <ExternalLink size={14} />
            新窗口打开
          </a>
        </div>
        {r.content?.query && (
          <details className="text-xs">
            <summary className="cursor-pointer text-claude-muted">查看生成 query</summary>
            <pre className="mt-1 p-2 bg-claude-panel rounded whitespace-pre-wrap">{r.content.query}</pre>
          </details>
        )}
        <p className="text-xs text-claude-muted">链接由讯飞服务端保存 30 天。</p>
      </div>
    );
  }
  // 思维导图：优先用解析后的树结构渲染，回退到 Markdown
  if (r.type === "mindmap") {
    const tree = r.content?.tree;
    if (tree && (tree.children?.length || tree.markdown_fallback)) {
      return <MindmapTree tree={tree} />;
    }
    if (r.content?.markdown) {
      return <Markdown>{r.content.markdown}</Markdown>;
    }
  }
  if (r.content?.mermaid) {
    const fence = String.fromCharCode(96, 96, 96);
    const md = fence + "mermaid\n" + r.content.mermaid + "\n" + fence;
    return <Markdown>{md}</Markdown>;
  }
  if (r.content?.markdown) {
    return <Markdown>{r.content.markdown}</Markdown>;
  }
  if (r.content?.questions) {
    const qs = r.content.questions as any[];
    return (
      <div className="space-y-2">
        {qs.map((q, i) => (
          <div key={i} className="text-sm border rounded-md p-2">
            <div className="font-medium">{i + 1}. [{q.type}] {q.stem}</div>
            {q.options && (
              <ul className="mt-1 text-xs text-claude-muted">
                {Object.entries(q.options).map(([k, v]: any) => (
                  <li key={k}>{k}. {v}</li>
                ))}
              </ul>
            )}
            <div className="mt-1 text-xs text-green-700">答案：{q.answer}</div>
            {q.analysis && <div className="text-xs text-claude-muted mt-1">解析：{q.analysis}</div>}
          </div>
        ))}
      </div>
    );
  }
  return <pre className="text-xs">{JSON.stringify(r.content, null, 2)}</pre>;
}

export default function ResourcesPage() {
  const student = useAppStore((s) => s.student);
  const resourceVersion = useAppStore((s) => s.resourceVersion);
  const [filter, setFilter] = useState("all");

  const { data: resources, isLoading } = useQuery({
    queryKey: ["resources", student?.id, resourceVersion],
    queryFn: () => (student ? api.listResources(student.id) : []),
    enabled: !!student,
  });

  const filtered = (resources ?? []).filter((r) => filter === "all" || r.type === filter);

  return (
    <div className="h-full overflow-y-auto">
      <header className="island-header">
        <div className="island-header-title">
          <FileText size={18} className="text-claude-accent" />
          <h1 className="font-semibold">资源库</h1>
          <Badge variant="accent">{filtered.length} 项</Badge>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 px-2.5 py-1 rounded-full text-xs",
                filter === f ? "bg-claude-accent text-white" : "bg-claude-panel text-claude-muted hover:bg-white"
              )}
            >
              {f === "all" ? "全部" : TYPE_META[f]?.label ?? f}
            </button>
          ))}
        </div>
      </header>

      <div className="p-5">
        {isLoading ? (
          <div className="text-claude-muted">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-claude-muted">
            <FileText size={40} className="mx-auto mb-3" />
            <p className="font-medium text-claude-ink">还没有生成资源</p>
            <p className="mt-2 text-sm">去对话页选择智能体生成第一份资源。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {filtered.map((r) => (
              <ResourceCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
