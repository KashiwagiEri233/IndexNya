import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, UploadCloud, FileText, Loader2, Trash2, Wand2, X } from "lucide-react";
import { api, type Literature, type LiteratureDetail, type ChatTerm } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { Markdown } from "@/components/chat/Markdown";
import { ExploreDock } from "@/components/explore/ExploreDock";
import { openExploreCard, resolveModel } from "@/lib/explore";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", txt: "TXT", md: "Markdown" };

export default function LiteraturePage() {
  const student = useAppStore((s) => s.student);
  const literatureVersion = useAppStore((s) => s.literatureVersion);
  const bumpLiteratures = useAppStore((s) => s.bumpLiteratures);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LiteratureDetail | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: literatures, isLoading } = useQuery({
    queryKey: ["literatures", student?.id, literatureVersion],
    queryFn: () => (student ? api.listLiteratures(student.id) : []),
    enabled: !!student,
  });

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api.getLiterature(selectedId).then((d) => {
      if (!cancelled) setDetail(d);
    }).catch(() => {
      if (!cancelled) setDetail(null);
    });
    return () => { cancelled = true; };
  }, [selectedId, literatureVersion]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !student) return;
    const file = files[0];
    setUploading(true);
    try {
      const lit = await api.uploadLiterature(student.id, file);
      bumpLiteratures();
      setSelectedId(lit.id);
      // 自动提取术语（哪里不懂点哪里）
      setExtractingId(lit.id);
      try {
        const model = resolveModel();
        const updated = await api.extractLiteratureTerms(
          lit.id,
          model ? { id: model.id, name: model.name, model: model.model, base_url: model.baseUrl, api_key: model.apiKey } : undefined
        );
        if (updated.terms.length > 0) bumpLiteratures();
        else alert("术语提取完成，但未识别到合适术语（可换一个模型重试）。");
      } catch (e: any) {
        alert(`术语提取失败：${e.message}（可在阅读视图中重试）`);
      } finally {
        setExtractingId(null);
      }
    } catch (e: any) {
      alert(`文献上传失败：${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function retryExtract(lit: Literature) {
    if (!student) return;
    setExtractingId(lit.id);
    try {
      const model = resolveModel();
      const updated = await api.extractLiteratureTerms(lit.id, model ? { id: model.id, name: model.name, model: model.model, base_url: model.baseUrl, api_key: model.apiKey } : undefined);
      bumpLiteratures();
      if (updated.terms.length === 0) alert("未识别到合适术语，可换一个模型重试。");
    } catch (e: any) {
      alert(`术语提取失败：${e.message}`);
    } finally {
      setExtractingId(null);
    }
  }

  async function removeLiterature(lit: Literature) {
    if (!window.confirm(`确定删除文献「${lit.title}」吗？`)) return;
    try {
      await api.deleteLiterature(lit.id);
      if (selectedId === lit.id) setSelectedId(null);
      bumpLiteratures();
    } catch (e: any) {
      alert(`删除失败：${e.message}`);
    }
  }

  function openTerm(term: ChatTerm, context: string) {
    if (!student) return;
    openExploreCard({
      term: term.text,
      explanation: term.explanation,
      context,
      mode: term.relation === "related" ? "related" : "child",
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="island-header">
        <div className="island-header-title">
          <ScrollText size={18} className="text-claude-accent" />
          <h1 className="font-semibold">文献阅读</h1>
          <Badge variant="accent">哪里不懂点哪里</Badge>
        </div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-2 text-xs font-bold text-claude-muted shadow-soft transition-colors hover:border-claude-accent/40 hover:text-claude-accent disabled:opacity-50"
        >
          <UploadCloud size={14} /> {uploading ? "上传中…" : "导入文献"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown"
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 文献列表 */}
        <aside className="flex w-[15rem] shrink-0 flex-col overflow-y-auto border-r border-claude-border/70 bg-[#f8fcfb]/70 p-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "mb-3 flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed px-3 py-5 text-center transition-colors",
              dragOver ? "border-claude-accent bg-claude-accentSoft/50" : "border-claude-border/80 bg-white/60 hover:border-claude-accent/50 hover:bg-white"
            )}
          >
            <UploadCloud size={20} className={cn(dragOver ? "text-claude-accent" : "text-claude-muted")} />
            <div className="text-xs font-extrabold text-claude-ink">拖入或点击上传</div>
            <div className="text-[10px] font-bold text-claude-muted">PDF / TXT / Markdown</div>
          </div>

          {isLoading && <div className="px-2 py-4 text-center text-xs text-claude-muted">加载中…</div>}
          {(literatures ?? []).length === 0 && !isLoading && (
            <div className="rounded-2xl border border-dashed border-claude-border bg-white/45 px-3 py-6 text-center text-xs font-semibold text-claude-muted">
              还没有文献<br />导入一份开始阅读吧
            </div>
          )}
          <div className="space-y-1">
            {(literatures ?? []).map((lit) => (
              <div
                key={lit.id}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-2xl px-2.5 py-2 transition-colors",
                  selectedId === lit.id ? "bg-white shadow-soft" : "hover:bg-white/75"
                )}
                onClick={() => setSelectedId(lit.id)}
              >
                <FileText size={14} className="mt-0.5 shrink-0 text-island-coral" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-extrabold text-claude-ink">{lit.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold text-claude-muted">
                    <span className="rounded-full bg-claude-panel px-1.5 py-px">{TYPE_LABEL[lit.source_type] ?? lit.source_type}</span>
                    <span>{lit.terms.length > 0 ? `${lit.terms.length} 个可点术语` : "未提取术语"}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void removeLiterature(lit); }}
                  className="shrink-0 rounded-lg p-1 text-claude-muted opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  title="删除文献"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* 阅读视图 */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {!detail ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-claude-muted">
              <ScrollText size={44} className="text-claude-accent/50" />
              <p className="max-w-sm text-sm font-semibold">
                导入 PDF / TXT / Markdown 文献，正文中的专业术语会被高亮标记——点击即可在旁边展开「深挖 / 对比 / 分支」探索卡片。
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-6 py-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-extrabold text-claude-ink">{detail.title}</h2>
                <Badge variant="accent">{TYPE_LABEL[detail.source_type] ?? detail.source_type}</Badge>
                <button
                  type="button"
                  disabled={extractingId === detail.id}
                  onClick={() => void retryExtract(detail)}
                  className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] font-bold text-claude-muted transition-colors hover:border-claude-accent/40 hover:text-claude-accent disabled:opacity-50"
                >
                  {extractingId === detail.id ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  {detail.terms.length > 0 ? "重新提取术语" : "提取术语"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] font-bold text-claude-muted transition-colors hover:text-claude-ink"
                >
                  <X size={12} /> 关闭
                </button>
              </div>
              {extractingId === detail.id && (
                <div className="mb-3 flex items-center gap-2 rounded-2xl border border-claude-accent/20 bg-claude-accentSoft/50 px-3 py-2 text-xs font-bold text-claude-accent">
                  <Loader2 size={13} className="animate-spin" /> 正在从正文中提取可点击术语…
                </div>
              )}
              <div className="rounded-[1.5rem] border border-white bg-white/85 p-6 shadow-soft">
                <Markdown terms={detail.terms} onTermClick={(term) => openTerm(term, detail.text.slice(0, 4000))}>
                  {detail.text}
                </Markdown>
              </div>
            </div>
          )}
        </div>
      </div>
      <ExploreDock />
    </div>
  );
}
