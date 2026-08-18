import { useState } from "react";
import { Check, ChevronDown, Settings2, X } from "lucide-react";
import { useAppStore, resolveSelectedModel, type SelectedModelEntry } from "@/stores/app";
import { cn } from "@/lib/utils";

/** 聊天框下的模型选择器 — 仅选择使用哪个模型；提供商与模型的增删统一在「设置」弹窗完成。 */
export function ModelSelector() {
  const providers = useAppStore((s) => s.providers);
  const selectedModelKey = useAppStore((s) => s.selectedModelKey);
  const setSelectedModelKey = useAppStore((s) => s.setSelectedModelKey);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [open, setOpen] = useState(false);
  const selected: SelectedModelEntry | undefined = resolveSelectedModel({ providers, selectedModelKey });
  const allModels = providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m, key: `${p.id}::${m.id}` })));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 max-w-[190px] items-center gap-1.5 rounded-full bg-island-panel px-3 text-[11px] font-bold text-island-inkSoft transition-colors hover:bg-island-accentSoft hover:text-island-accentDeep"
        title={`当前模型：${selected?.model.name ?? "未选择"}（${selected?.provider.name ?? ""}）`}
      >
        <span className="max-w-[150px] truncate">{selected ? `${selected.provider.name} · ${selected.model.name}` : "选择模型"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute bottom-10 right-0 z-30 w-80 rounded-island border border-island-border bg-island-card p-2 shadow-island-hover">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-sm font-extrabold text-island-ink">选择模型</div>
              <div className="text-[11px] text-island-muted">提供商与模型管理请前往「设置」页</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-island-muted hover:bg-island-panel"><X size={14} /></button>
          </div>
          <div className="mt-1 max-h-72 space-y-2 overflow-y-auto">
            {allModels.length === 0 && (
              <div className="rounded-[14px] border-2 border-dashed border-island-borderStrong/40 px-3 py-3 text-center text-xs font-semibold text-island-muted">
                暂无模型，请到设置页添加提供商
              </div>
            )}
            {providers.map((provider) => {
              if (provider.models.length === 0) return null;
              return (
                <div key={provider.id}>
                  <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-island-muted/80">
                    {provider.name}
                    <span className="text-[9px] font-bold text-island-muted/50">{provider.baseUrl}</span>
                  </div>
                  <div className="space-y-0.5">
                    {provider.models.map((model) => {
                      const key = `${provider.id}::${model.id}`;
                      const active = key === selectedModelKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setSelectedModelKey(key); setOpen(false); }}
                          className={cn("flex w-full items-center gap-2 rounded-[14px] px-2 py-2 text-left hover:bg-island-panel/70", active && "bg-island-accentSoft")}
                        >
                          <Check size={14} className={active ? "text-island-accentDeep" : "text-transparent"} />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold text-island-ink">{model.name}</span>
                            <span className="block truncate text-[10px] text-island-muted">{model.id}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); setSettingsOpen(true); }}
            className="btn-default mt-2 h-9 w-full text-xs"
          >
            <Settings2 size={13} /> 管理提供商
          </button>
        </div>
      )}
    </div>
  );
}
