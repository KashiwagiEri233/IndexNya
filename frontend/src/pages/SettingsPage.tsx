import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, PlugZap, Settings2, Trash2, Upload, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ChatModel, type Skill } from "@/lib/api";
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
        <div className="mt-3 grid gap-3 md:grid-cols-2"><Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="显示名称，如 DeepSeek" /><Input value={form.model} onChange={(e) => updateForm({ model: e.target.value })} placeholder="模型 ID，如 deepseek-chat" /><Input value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} placeholder="Base URL，如 https://api.example.com/v1" /><Input type="password" value={form.apiKey} onChange={(e) => updateForm({ apiKey: e.target.value })} placeholder="API Key" /></div>
        {testState && <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${testState.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}><div className="font-bold">{testState.ok ? "✓ " : "× "}{testState.message}</div>{!testState.ok && testState.detail && <details className="mt-1.5"><summary className="cursor-pointer font-semibold underline decoration-dotted">查看错误报告</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-2 text-[10px] leading-4">{testState.detail}</pre></details>}</div>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">{editingModelId && <Button type="button" variant="outline" onClick={resetForm}>取消修改</Button>}<Button type="button" variant="soft" onClick={testConnection} disabled={!formReady || testing}>{testing ? "测试中…" : "测试连接"}</Button><Button type="button" onClick={saveModel} disabled={!formReady || testing}><Settings2 size={15} /> {editingModelId ? "保存修改" : "保存并使用"}</Button></div>
      </div>
    </section>
  );
}

/** 技能管理：已安装技能列表（全局开关 / 卸载）+ .zip 技能包上传安装。 */
function SkillSettingsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    api.listSkills().then(setSkills).catch(() => setSkills([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function toggle(skill: Skill) {
    try {
      await api.setSkillEnabled(skill.name, !skill.enabled);
      refresh();
    } catch (e: any) {
      alert(`开关失败：${e.message}`);
    }
  }

  async function uninstall(skill: Skill) {
    if (!window.confirm(`确定卸载技能「${skill.title}」（${skill.name}）吗？`)) return;
    try {
      await api.deleteSkill(skill.name);
      refresh();
    } catch (e: any) {
      alert(`卸载失败：${e.message}`);
    }
  }

  async function upload() {
    if (!file) {
      alert("请先选择 .zip 技能包。");
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const result = await api.installSkill(file);
      setMessage({ ok: true, text: `${result.message} 对话页与 agent 立即可用，无需重启。` });
      setFile(null);
      refresh();
    } catch (e: any) {
      setMessage({ ok: false, text: `安装失败：${e.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-extrabold">技能管理</h2><p className="mt-1 text-xs leading-5 text-claude-muted">技能以 Anthropic Skills 规范存储（backend/app/skills/{"{name}"}/SKILL.md），通过上传 .zip 技能包安装；可随时卸载与开关，开启后 agent 会在对话中按需调用，也可在对话页快捷栏点选。</p></div><Wand2 size={20} className="text-island-lavender" /></div>

      <div className="mt-4 space-y-2">
        {skills.length === 0 && <div className="rounded-2xl border border-dashed border-claude-border px-4 py-5 text-center text-sm font-semibold text-claude-muted">还没有技能，请在下方上传一个 .zip 技能包。</div>}
        {skills.map((skill) => (
          <div key={skill.name} className={cn("flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors", skill.enabled ? "border-island-lavender/40 bg-island-lavender/5" : "bg-white opacity-75")}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-claude-ink">{skill.title}</span>
                <span className="text-[10px] font-bold text-claude-muted">{skill.name}</span>
                <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-bold", skill.enabled ? "border-green-200 bg-green-50 text-green-600" : "border-claude-border bg-claude-panel text-claude-muted")}>{skill.enabled ? "已开启" : "已关闭"}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-claude-muted">{skill.description || "（无描述）"}</p>
            </div>
            <button
              type="button"
              onClick={() => toggle(skill)}
              className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", skill.enabled ? "bg-island-lavender" : "bg-claude-border")}
              title={skill.enabled ? "点击关闭（不再被 agent 与快捷栏使用）" : "点击开启"}
            >
              <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", skill.enabled ? "left-[22px]" : "left-0.5")} />
            </button>
            <button type="button" onClick={() => uninstall(skill)} className="rounded-xl p-2 text-claude-muted hover:bg-red-50 hover:text-red-500" title="卸载技能"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-claude-border/70 pt-4">
        <h3 className="text-sm font-extrabold">上传 .zip 技能包</h3>
        <p className="mt-1 text-xs text-claude-muted">压缩包内可直接放 SKILL.md（技能名取压缩包文件名），或放一个/多个技能文件夹（文件夹名即技能标识，内含大小写完全一致的 SKILL.md）。SKILL.md 使用 frontmatter 声明 name / description，可附带 scripts/ 等辅助文件。</p>
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-claude-border bg-white px-3 py-4 text-sm font-semibold text-claude-muted transition-colors hover:border-claude-accent/40 hover:text-claude-accent">
          <Upload size={15} /> {file ? file.name : "选择 .zip 技能包"}
          <input type="file" accept=".zip" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {message && <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{message.text}</div>}
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={upload} disabled={busy || !file}><Wand2 size={15} /> {busy ? "安装中…" : "上传并安装"}</Button>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const models = useAppStore((s) => s.models);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppStore((s) => s.setSelectedModelId);
  return (
    <div className="h-full overflow-y-auto"><header className="island-header justify-start gap-2"><Settings2 size={18} className="text-claude-accent" /><h1 className="font-semibold">设置</h1></header><div className="mx-auto max-w-4xl space-y-5 p-5"><ModelSettingsSection type="chat" title="对话模型" description="模型统一在这里配置（新增/修改/删除）；聊天框下方的选择器只负责切换使用哪个模型。" models={models.filter((model) => model.type !== "image")} selectedId={selectedModelId} onSelect={setSelectedModelId} /><SkillSettingsSection /></div></div>
  );
}