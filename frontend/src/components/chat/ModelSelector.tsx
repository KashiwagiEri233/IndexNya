import { useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, type ChatModel } from "@/lib/api";
import { useAppStore } from "@/stores/app";

const EMPTY_FORM = { name: "", model: "", baseUrl: "", apiKey: "" };

export function ModelSelector() {
  const models = useAppStore((s) => s.models);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppStore((s) => s.setSelectedModelId);
  const addModel = useAppStore((s) => s.addModel);
  const removeModel = useAppStore((s) => s.removeModel);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const selected = models.find((model) => model.id === selectedModelId) ?? models[0];

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingModelId(null);
    setShowForm(false);
    setTesting(false);
    setTestState(null);
  }

  function updateForm(patch: Partial<typeof EMPTY_FORM>) {
    setForm((current) => ({ ...current, ...patch }));
    setTestState(null);
  }

  function beginAdd() {
    setForm(EMPTY_FORM);
    setEditingModelId(null);
    setShowForm(true);
    setTestState(null);
  }

  function beginEdit(model: ChatModel) {
    setForm({
      name: model.name,
      model: model.model,
      baseUrl: model.baseUrl || "",
      apiKey: model.apiKey || "",
    });
    setEditingModelId(model.id);
    setShowForm(true);
    setTestState(null);
  }

  async function testConnection() {
    if (!form.name.trim() || !form.model.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || testing) return;
    setTesting(true);
    setTestState(null);
    try {
      const result = await api.testModelConnection({
        name: form.name.trim(),
        model: form.model.trim(),
        base_url: form.baseUrl.trim(),
        api_key: form.apiKey.trim(),
      });
      setTestState({ ok: result.ok, message: result.message, detail: result.detail });
    } catch (error: any) {
      setTestState({ ok: false, message: error.message, detail: error.stack || error.message });
    } finally {
      setTesting(false);
    }
  }

  function submit() {
    if (!form.name.trim() || !form.model.trim() || !form.baseUrl.trim() || !form.apiKey.trim()) return;
    const model: ChatModel = {
      id: editingModelId || `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: form.name.trim(),
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
    };
    addModel(model);
    resetForm();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-[190px] items-center gap-1.5 rounded-lg bg-claude-panel/70 px-2 py-1 text-[11px] font-bold text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent"
        title="选择或添加模型"
      >
        <span className="max-w-[150px] truncate">{selected?.name || "选择模型"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute bottom-10 right-0 z-30 w-80 rounded-2xl border border-white bg-white p-2 shadow-island">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-sm font-extrabold text-claude-ink">模型</div>
              <div className="text-[11px] text-claude-muted">支持 OpenAI 兼容接口</div>
            </div>
            <button type="button" onClick={() => { resetForm(); setOpen(false); }} className="rounded-full p-1 text-claude-muted hover:bg-claude-panel"><X size={14} /></button>
          </div>
          <div className="mt-1 space-y-1">
            {models.length === 0 && (
              <div className="rounded-xl border border-dashed border-claude-border px-3 py-3 text-center text-xs font-semibold text-claude-muted">
                暂无模型，请先添加一个模型
              </div>
            )}
            {models.map((model) => (
              <div key={model.id} className="flex items-center gap-1 rounded-xl px-2 py-2 hover:bg-claude-panel/70">
                <button
                  type="button"
                  onClick={() => { setSelectedModelId(model.id); setOpen(false); }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Check size={14} className={model.id === selectedModelId ? "text-claude-accent" : "text-transparent"} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-claude-ink">{model.name}</span>
                    <span className="block truncate text-[10px] text-claude-muted">{model.model}</span>
                  </span>
                </button>
                <button type="button" onClick={() => beginEdit(model)} className="rounded-lg p-1 text-claude-muted hover:bg-claude-accentSoft hover:text-claude-accent" title="修改模型配置"><Pencil size={13} /></button>
                <button type="button" onClick={() => removeModel(model.id)} className="rounded-lg p-1 text-claude-muted hover:bg-red-50 hover:text-red-500" title="删除模型"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          {!showForm ? (
            <Button type="button" variant="soft" size="sm" className="mt-2 w-full" onClick={beginAdd}>
              <Plus size={14} /> 添加模型
            </Button>
          ) : (
            <div className="mt-2 space-y-2 border-t pt-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-extrabold">{editingModelId ? "修改模型配置" : "添加 OpenAI 兼容模型"}</span>
                <button type="button" onClick={resetForm} className="text-claude-muted"><X size={14} /></button>
              </div>
              <Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="显示名称，如 DeepSeek" />
              <Input value={form.model} onChange={(e) => updateForm({ model: e.target.value })} placeholder="模型 ID，如 deepseek-chat" />
              <Input value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} placeholder="Base URL，如 https://api.deepseek.com/v1" />
              <Input type="password" value={form.apiKey} onChange={(e) => updateForm({ apiKey: e.target.value })} placeholder="API Key" />
              {testState && (
                <div className={`rounded-lg px-2.5 py-2 text-[11px] ${testState.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  <div className="font-semibold">{testState.ok ? "✓ " : "× "}{testState.message}</div>
                  {!testState.ok && testState.detail && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer select-none font-semibold underline decoration-dotted underline-offset-2">查看错误报告</summary>
                      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/5 p-2 text-[10px] font-normal leading-4">{testState.detail}</pre>
                    </details>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={resetForm}>取消</Button>
                <Button type="button" variant="soft" size="sm" className="flex-1" onClick={testConnection} disabled={testing || !form.name.trim() || !form.model.trim() || !form.baseUrl.trim() || !form.apiKey.trim()}>
                  {testing ? "测试中…" : "测试连接"}
                </Button>
                <Button type="button" size="sm" className="flex-1" onClick={submit} disabled={testing || !form.name.trim() || !form.model.trim() || !form.baseUrl.trim() || !form.apiKey.trim()}><Settings2 size={14} /> {editingModelId ? "保存修改" : "保存并使用"}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
