import { useState } from "react";
import { Brain, Check, ChevronDown, X } from "lucide-react";
import { useAppStore, type ReasoningLevel } from "@/stores/app";
import { cn } from "@/lib/utils";

const LEVELS: { id: ReasoningLevel; label: string; hint: string }[] = [
  { id: "off", label: "关闭", hint: "不传推理参数，由接口默认" },
  { id: "minimal", label: "最低", hint: "极少推理，响应最快" },
  { id: "low", label: "低", hint: "轻量思考，响应较快" },
  { id: "medium", label: "中", hint: "平衡速度与深度" },
  { id: "high", label: "高", hint: "较深推理，耗时更长" },
  { id: "xhigh", label: "极高", hint: "深度推理，显著更慢" },
  { id: "max", label: "最大", hint: "全力以赴，最慢最全面" },
];

/** 聊天框内的模型推理强度选择器 — 选择随请求透传给模型的 reasoning_effort。 */
export function ReasoningSelector() {
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const setReasoningEffort = useAppStore((s) => s.setReasoningEffort);
  const [open, setOpen] = useState(false);
  const current = LEVELS.find((l) => l.id === reasoningEffort) ?? LEVELS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-island-panel px-3 text-[11px] font-bold text-island-inkSoft transition-colors hover:bg-island-accentSoft hover:text-island-accentDeep"
        title={`推理强度：${current.label}（${current.hint}）`}
      >
        <Brain size={13} />
        <span>推理 {current.label}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute bottom-10 right-0 z-30 w-56 rounded-island border border-island-border bg-island-card p-2 shadow-island-hover">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-sm font-extrabold text-island-ink">推理强度</div>
              <div className="text-[11px] text-island-muted">随请求透传给支持的模型接口</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-island-muted hover:bg-island-panel"><X size={14} /></button>
          </div>
          <div className="mt-1 max-h-64 space-y-0.5 overflow-y-auto">
            {LEVELS.map((level) => {
              const active = level.id === reasoningEffort;
              return (
                <button
                  key={level.id}
                  type="button"
                  onClick={() => { setReasoningEffort(level.id); setOpen(false); }}
                  className={cn("flex w-full items-center gap-2 rounded-[14px] px-2 py-2 text-left hover:bg-island-panel/70", active && "bg-island-accentSoft")}
                >
                  <Check size={14} className={active ? "text-island-accentDeep" : "text-transparent"} />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-island-ink">{level.label}</span>
                    <span className="block truncate text-[10px] text-island-muted">{level.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
