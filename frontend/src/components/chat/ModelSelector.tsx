import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Settings2, X } from "lucide-react";
import { useAppStore } from "@/stores/app";

/** 聊天框下的模型选择器 — 仅选择使用哪个模型；模型的新增/编辑/删除统一在「设置」页完成。 */
export function ModelSelector() {
  const models = useAppStore((s) => s.models);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppStore((s) => s.setSelectedModelId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const chatModels = models.filter((model) => model.type !== "image");
  const selected = chatModels.find((model) => model.id === selectedModelId) ?? chatModels[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-[190px] items-center gap-1.5 rounded-lg bg-claude-panel/70 px-2 py-1 text-[11px] font-bold text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent"
        title="选择使用的模型"
      >
        <span className="max-w-[150px] truncate">{selected?.name || "选择模型"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute bottom-10 right-0 z-30 w-80 rounded-2xl border border-white bg-white p-2 shadow-island">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-sm font-extrabold text-claude-ink">选择模型</div>
              <div className="text-[11px] text-claude-muted">模型管理请前往「设置」页</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-claude-muted hover:bg-claude-panel"><X size={14} /></button>
          </div>
          <div className="mt-1 space-y-1">
            {chatModels.length === 0 && (
              <div className="rounded-xl border border-dashed border-claude-border px-3 py-3 text-center text-xs font-semibold text-claude-muted">
                暂无模型，请到设置页添加
              </div>
            )}
            {chatModels.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => { setSelectedModelId(model.id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-claude-panel/70"
              >
                <Check size={14} className={model.id === selectedModelId ? "text-claude-accent" : "text-transparent"} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-claude-ink">{model.name}</span>
                  <span className="block truncate text-[10px] text-claude-muted">{model.model}</span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/settings"); }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-claude-border/70 bg-white px-2 py-2 text-xs font-bold text-claude-muted transition-colors hover:border-claude-accent/40 hover:bg-claude-accentSoft hover:text-claude-accent"
          >
            <Settings2 size={13} /> 管理模型
          </button>
        </div>
      )}
    </div>
  );
}