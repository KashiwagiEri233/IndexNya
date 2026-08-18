/** 设置弹窗 — 全屏遮罩 + 居中面板，
 *  左侧导航栏（分区列表），右侧 header（关闭按钮）+ 滚动内容区。 */
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, PlugZap, Settings2, Trash2, Upload, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ModelProvider, type Skill } from "@/lib/api";
import { useAppStore, modelKeyOf } from "@/stores/app";
import { cn } from "@/lib/utils";

const EMPTY_PROVIDER_FORM = { name: "", baseUrl: "", apiKey: "", testModel: "" };
const EMPTY_MODEL_FORM = { id: "", name: "" };

/* ============================================================
 * 弹窗壳：nav rail + 内容列
 * ============================================================ */

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const [activeId, setActiveId] = useState<string>("providers");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  const NAV = [
    { id: "providers", label: "模型提供商", icon: PlugZap },
    { id: "skills", label: "技能", icon: Wand2 },
  ];
  const active = NAV.find((n) => n.id === activeId)?.id ?? NAV[0].id;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
      {/* 遮罩：点击关闭 */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" aria-hidden="true" onClick={() => setOpen(false)} />
      <div
        className="relative z-10 flex h-[min(720px,calc(100vh-48px))] w-[min(860px,calc(100vw-48px))] overflow-hidden rounded-3xl bg-white shadow-island animate-float-in"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        {/* 左侧导航栏 */}
        <nav className="flex w-[188px] shrink-0 flex-col gap-4 px-3 pt-6">
          <div className="px-3 text-base font-semibold text-claude-ink">设置</div>
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex h-10 items-center gap-2 rounded-xl px-3 text-left text-sm transition-colors",
                  item.id === active ? "bg-claude-panel font-bold text-claude-ink" : "font-medium text-claude-muted hover:bg-claude-panel/70"
                )}
                aria-current={item.id === active ? "true" : undefined}
                onClick={() => setActiveId(item.id)}
              >
                <item.icon size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 右侧内容列 */}
        <div className="flex min-w-0 flex-1 flex-col border-l border-claude-border/70">
          <div className="flex h-14 shrink-0 items-center justify-end gap-2 px-4 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-claude-muted transition-colors hover:bg-claude-panel hover:text-claude-ink"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {active === "providers" ? <ProvidersSection /> : <SkillsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 模型提供商分区：title/intro + 行卡片 + 底部添加区
 * ============================================================ */

function ProvidersSection() {
  const providers = useAppStore((s) => s.providers);
  const selectedModelKey = useAppStore((s) => s.selectedModelKey);
  const addProvider = useAppStore((s) => s.addProvider);
  const removeProvider = useAppStore((s) => s.removeProvider);
  const addModel = useAppStore((s) => s.addModel);
  const removeModel = useAppStore((s) => s.removeModel);
  const setSelectedModelKey = useAppStore((s) => s.setSelectedModelKey);

  const [form, setForm] = useState(EMPTY_PROVIDER_FORM);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState(EMPTY_MODEL_FORM);

  const updateForm = (patch: Partial<typeof EMPTY_PROVIDER_FORM>) => { setForm((current) => ({ ...current, ...patch })); setTestState(null); };
  const formReady = Boolean(form.name.trim() && form.baseUrl.trim() && form.apiKey.trim());

  async function testConnection() {
    if (!formReady || testing) return;
    if (!form.testModel.trim()) {
      alert("请先填写「测试用模型 ID」（如 deepseek-chat）再测试连接。");
      return;
    }
    setTesting(true); setTestState(null);
    try {
      const result = await api.testModelConnection({ name: form.name.trim(), model: form.testModel.trim(), base_url: form.baseUrl.trim(), api_key: form.apiKey.trim(), type: "chat" });
      setTestState({ ok: result.ok, message: result.message, detail: result.detail });
    } catch (error: any) {
      setTestState({ ok: false, message: error.message, detail: error.stack || error.message });
    } finally {
      setTesting(false);
    }
  }

  function saveProvider() {
    if (!formReady) return;
    const provider: ModelProvider = {
      id: `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      models: [],
    };
    addProvider(provider);
    setExpandedId(provider.id);
    setNotice({ ok: true, text: `已保存提供商「${provider.name}」，请在其下方添加模型。` });
    setForm(EMPTY_PROVIDER_FORM);
    setTestState(null);
  }

  function saveModel(providerId: string) {
    const id = modelForm.id.trim();
    const name = modelForm.name.trim();
    if (!id) {
      alert("请填写模型 ID。");
      return;
    }
    addModel(providerId, { id, name: name || id });
    setNotice({ ok: true, text: `已添加模型「${name || id}」，可在聊天框选择使用。` });
    setModelForm(EMPTY_MODEL_FORM);
  }

  const providerInUse = (providerId: string) => selectedModelKey.startsWith(`${providerId}::`);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-claude-ink">模型提供商</h2>
        <p className="mt-0.5 text-sm leading-6 text-claude-muted">先添加提供商（OpenAI 兼容端点），再在提供商内添加可选模型；聊天框下方的选择器按提供商分组切换使用哪个模型。</p>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {providers.length === 0 && (
          <div className="rounded-xl border border-dashed border-claude-border px-4 py-5 text-center text-sm font-semibold text-claude-muted">还没有提供商，请在下方添加一个。</div>
        )}
        {providers.map((provider) => {
          const expanded = expandedId === provider.id;
          const inUse = providerInUse(provider.id);
          return (
            <div key={provider.id} className={cn("flex flex-col gap-3 rounded-xl border px-3.5 py-3", inUse ? "border-claude-accent/50" : "border-claude-border")}>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : provider.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  title={expanded ? "收起" : "展开管理模型"}
                >
                  <ChevronDown size={15} className={cn("shrink-0 text-claude-muted transition-transform", expanded && "rotate-180")} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-claude-ink">{provider.name}</span>
                      {inUse && <span className="rounded border border-claude-accent/40 bg-claude-accentSoft px-1.5 py-px text-[11px] font-bold text-claude-accent">使用中</span>}
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", provider.apiKey ? "bg-emerald-400" : "bg-claude-border")}
                        title={provider.apiKey ? "API Key 已配置" : "未配置 API Key"}
                      />
                    </span>
                    <span className="block truncate text-xs text-claude-muted">{provider.baseUrl} · {provider.models.length} 个模型</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => { if (window.confirm(`确定删除提供商「${provider.name}」及其全部模型吗？`)) { removeProvider(provider.id); if (expandedId === provider.id) setExpandedId(null); } }} className="flex h-7 items-center rounded-full px-2.5 text-xs font-bold text-red-400 transition-colors hover:bg-red-50" title="删除提供商"><Trash2 size={13} /> 删除</button>
                </div>
              </div>
              {expanded && (
                <div className="flex flex-col gap-3 rounded-xl bg-claude-panel/70 p-4">
                  {provider.models.length === 0 && <div className="rounded-lg border border-dashed border-claude-border px-3 py-2.5 text-center text-xs font-semibold text-claude-muted">该提供商还没有模型，请在下方添加。</div>}
                  <div className="flex flex-col gap-1">
                    {provider.models.map((model) => {
                      const key = modelKeyOf(provider.id, model.id);
                      const active = key === selectedModelKey;
                      return (
                        <div key={model.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/70">
                          <button
                            type="button"
                            onClick={() => setSelectedModelKey(key)}
                            className={cn("flex min-w-0 flex-1 items-center gap-2 text-left", active && "text-claude-accent")}
                            title={active ? "正在使用" : "点击设为使用"}
                          >
                            <Check size={14} className={active ? "shrink-0 text-claude-accent" : "shrink-0 text-transparent"} />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-bold text-claude-ink">{model.name}</span>
                              <span className="block truncate text-[10px] text-claude-muted">{model.id}</span>
                            </span>
                          </button>
                          <button type="button" onClick={() => removeModel(provider.id, model.id)} className="rounded-lg p-1.5 text-claude-muted hover:bg-red-50 hover:text-red-500" title="删除模型"><Trash2 size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-end gap-2 border-t border-claude-border/60 pt-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-claude-muted">模型 ID</label>
                      <Input value={modelForm.id} onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })} placeholder="如 deepseek-chat" className="h-9 w-48 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-claude-muted">显示名</label>
                      <Input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="可空" className="h-9 w-36 text-sm" />
                    </div>
                    <Button type="button" variant="soft" size="sm" onClick={() => saveModel(provider.id)}>添加模型</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-col gap-3 border-t border-claude-border/70 pt-4">
        <h3 className="text-sm font-semibold text-claude-ink">添加提供商</h3>
        <p className="-mt-1 text-xs leading-5 text-claude-muted">支持 OpenAI 兼容接口（如 DeepSeek、OpenAI、本地 Ollama 等）；「测试用模型 ID」仅用于测试连接，无需与后续添加的模型一致。</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-claude-muted">提供商名称</label>
            <Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="如 DeepSeek" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-claude-muted">Base URL</label>
            <Input value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} placeholder="如 https://api.deepseek.com/v1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-claude-muted">API Key</label>
            <Input type="password" value={form.apiKey} onChange={(e) => updateForm({ apiKey: e.target.value })} placeholder="sk-…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-claude-muted">测试用模型 ID（可选）</label>
            <Input value={form.testModel} onChange={(e) => updateForm({ testModel: e.target.value })} placeholder="如 deepseek-chat" />
          </div>
        </div>
        {testState && <div className={`rounded-xl px-3 py-2 text-xs ${testState.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}><div className="font-bold">{testState.ok ? "✓ " : "× "}{testState.message}</div>{!testState.ok && testState.detail && <details className="mt-1.5"><summary className="cursor-pointer font-semibold underline decoration-dotted">查看错误报告</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-2 text-[10px] leading-4">{testState.detail}</pre></details>}</div>}
        {notice && <div className={`rounded-xl px-3 py-2 text-xs ${notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{notice.text}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={testConnection} disabled={!formReady || testing}>{testing ? "测试中…" : "测试连接"}</Button>
          <Button type="button" onClick={saveProvider} disabled={!formReady || testing}><Settings2 size={15} /> 保存提供商</Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 技能分区：title/intro + 行卡片 + 底部上传区
 * ============================================================ */

function SkillsSection() {
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
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-claude-ink">技能</h2>
        <p className="mt-0.5 text-sm leading-6 text-claude-muted">技能以 Anthropic Skills 规范存储（backend/app/skills/{"{name}"}/SKILL.md），通过上传 .zip 技能包安装；可随时卸载与开关，开启后 agent 会在对话中按需调用。</p>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {skills.length === 0 && <div className="rounded-xl border border-dashed border-claude-border px-4 py-5 text-center text-sm font-semibold text-claude-muted">还没有技能，请在下方上传一个 .zip 技能包。</div>}
        {skills.map((skill) => (
          <div key={skill.name} className={cn("flex items-center gap-3 rounded-xl border px-3.5 py-3", skill.enabled ? "border-island-lavender/40 bg-island-lavender/5" : "border-claude-border bg-white opacity-75")}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-claude-ink">{skill.title}</span>
                <span className="text-[10px] font-bold text-claude-muted">{skill.name}</span>
                <span className={cn("rounded border px-1.5 py-px text-[10px] font-bold", skill.enabled ? "border-green-200 bg-green-50 text-green-600" : "border-claude-border bg-claude-panel text-claude-muted")}>{skill.enabled ? "已开启" : "已关闭"}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-claude-muted">{skill.description || "（无描述）"}</p>
            </div>
            <button
              type="button"
              onClick={() => toggle(skill)}
              className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", skill.enabled ? "bg-island-lavender" : "bg-claude-border")}
              title={skill.enabled ? "点击关闭（不再被 agent 使用）" : "点击开启"}
            >
              <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", skill.enabled ? "left-[22px]" : "left-0.5")} />
            </button>
            <button type="button" onClick={() => uninstall(skill)} className="rounded-xl p-2 text-claude-muted hover:bg-red-50 hover:text-red-500" title="卸载技能"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-3 border-t border-claude-border/70 pt-4">
        <h3 className="text-sm font-semibold text-claude-ink">上传 .zip 技能包</h3>
        <p className="-mt-1 text-xs leading-5 text-claude-muted">压缩包内可直接放 SKILL.md（技能名取压缩包文件名），或放一个/多个技能文件夹（文件夹名即技能标识，内含大小写完全一致的 SKILL.md）。SKILL.md 使用 frontmatter 声明 name / description，可附带 scripts/ 等辅助文件。</p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-claude-border bg-white px-3 py-4 text-sm font-semibold text-claude-muted transition-colors hover:border-claude-accent/40 hover:text-claude-accent">
          <Upload size={15} /> {file ? file.name : "选择 .zip 技能包"}
          <input type="file" accept=".zip" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {message && <div className={`rounded-xl px-3 py-2 text-xs ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{message.text}</div>}
        <div className="flex justify-end">
          <Button type="button" onClick={upload} disabled={busy || !file}><Wand2 size={15} /> {busy ? "安装中…" : "上传并安装"}</Button>
        </div>
      </div>
    </div>
  );
}
