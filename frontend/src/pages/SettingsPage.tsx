import { useState } from "react";
import { Check, Pencil, PlugZap, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ChatModel } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

type ModelType = "chat" | "image";
const EMPTY_FORM = { name: "", model: "", baseUrl: "", apiKey: "" };

function ModelSettingsSection({ type, title, description, models, selectedId, onSelect }: { type: ModelType; title: string; description: string; models: ChatModel[]; selectedId: string; onSelect: (id: string) => void }) {
  const addModel = useAppStore((s) => s.addModel);
  const removeModel = useAppStore((s) => s.removeModel);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const updateForm = (patch: Partial<typeof EMPTY_FORM>) => { setForm((current) => ({ ...current, ...patch })); setTestState(null); };
  const resetForm = () => { setEditingModelId(null); setForm(EMPTY_FORM); setTestState(null); setTesting(false); };
  const editModel = (model: ChatModel) => { setEditingModelId(model.id); setForm({ name: model.name, model: model.model, baseUrl: model.baseUrl || "", apiKey: model.apiKey || "" }); setTestState(null); };
  const formReady = Boolean(form.name.trim() && form.model.trim() && form.baseUrl.trim() && form.apiKey.trim());

  async function testConnection() {
    if (!formReady || testing) return;
    setTesting(true); setTestState(null);
    try {
      const result = await api.testModelConnection({ name: form.name.trim(), model: form.model.trim(), base_url: form.baseUrl.trim(), api_key: form.apiKey.trim(), type });
      setTestState({ ok: result.ok, message: result.message, detail: result.detail });
    } catch (error: any) { setTestState({ ok: false, message: error.message, detail: error.stack || error.message }); }
    finally { setTesting(false); }
  }

  function saveModel() {
    if (!formReady) return;
    addModel({ id: editingModelId || `custom-${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: form.name.trim(), model: form.model.trim(), baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(), type });
    resetForm();
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-extrabold">{title}</h2><p className="mt-1 text-xs leading-5 text-claude-muted">{description}</p></div><PlugZap size={20} className="text-claude-accent" /></div>
      <div className="mt-4 space-y-2">
        {models.length === 0 && <div className="rounded-2xl border border-dashed border-claude-border px-4 py-5 text-center text-sm font-semibold text-claude-muted">还没有{title}配置，请在下方添加一个。</div>}
        {models.map((model) => (
          <div key={model.id} className={cn("flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors", model.id === selectedId ? "border-claude-accent/40 bg-claude-accentSoft/45" : "bg-white hover:bg-claude-panel/50")}>
            <button type="button" onClick={() => onSelect(model.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", model.id === selectedId ? "bg-claude-accent text-white" : "bg-claude-panel text-claude-muted")}><Check size={15} className={model.id === selectedId ? "" : "opacity-0"} /></span><span className="min-w-0"><span className="block truncate text-sm font-bold text-claude-ink">{model.name}</span><span className="block truncate text-xs text-claude-muted">{model.model} · {model.baseUrl}</span></span></button>
            <button type="button" onClick={() => editModel(model)} className="rounded-xl p-2 text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent" title="修改模型配置"><Pencil size={15} /></button>
            <button type="button" onClick={() => removeModel(model.id)} className="rounded-xl p-2 text-claude-muted hover:bg-red-50 hover:text-red-500" title="删除模型"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-claude-border/70 pt-4">
        <div className="flex items-center justify-between"><div><h3 className="text-sm font-extrabold">{editingModelId ? "修改配置" : `添加${title}`}</h3><p className="mt-1 text-xs text-claude-muted">支持 OpenAI 兼容接口。</p></div>{editingModelId && <button type="button" onClick={resetForm} className="rounded-full p-2 text-claude-muted hover:bg-claude-panel" title="取消修改"><X size={16} /></button>}</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2"><Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="显示名称，如 DeepSeek" /><Input value={form.model} onChange={(e) => updateForm({ model: e.target.value })} placeholder={type === "image" ? "图片模型 ID，如 dall-e-3" : "模型 ID，如 deepseek-chat"} /><Input value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} placeholder="Base URL，如 https://api.example.com/v1" /><Input type="password" value={form.apiKey} onChange={(e) => updateForm({ apiKey: e.target.value })} placeholder="API Key" /></div>
        {testState && <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${testState.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}><div className="font-bold">{testState.ok ? "✓ " : "× "}{testState.message}</div>{!testState.ok && testState.detail && <details className="mt-1.5"><summary className="cursor-pointer font-semibold underline decoration-dotted">查看错误报告</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-2 text-[10px] leading-4">{testState.detail}</pre></details>}</div>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">{editingModelId && <Button type="button" variant="outline" onClick={resetForm}>取消修改</Button>}<Button type="button" variant="soft" onClick={testConnection} disabled={!formReady || testing}>{testing ? "测试中…" : "测试连接"}</Button><Button type="button" onClick={saveModel} disabled={!formReady || testing}><Settings2 size={15} /> {editingModelId ? "保存修改" : "保存并使用"}</Button></div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const models = useAppStore((s) => s.models);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppStore((s) => s.setSelectedModelId);
  return (
    <div className="h-full overflow-y-auto"><header className="island-header justify-start gap-2"><Settings2 size={18} className="text-claude-accent" /><h1 className="font-semibold">设置</h1></header><div className="mx-auto max-w-4xl space-y-5 p-5"><ModelSettingsSection type="chat" title="对话模型" description="用于学习对话、辅导回答、图片理解（需支持多模态的模型）和专有名词子对话。" models={models.filter((model) => model.type !== "image")} selectedId={selectedModelId} onSelect={setSelectedModelId} /></div></div>
  );
}
