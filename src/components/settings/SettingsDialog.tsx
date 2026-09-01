/** 设置弹窗 — 全屏遮罩 + 居中面板，
 *  左侧导航栏（分区列表），右侧 header（关闭按钮）+ 滚动内容区。 */
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Database, Download, FileJson, Monitor, Moon, NotebookPen, Palette, PlugZap, RotateCcw, Settings2, SlidersHorizontal, Sun, Trash2, Upload, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RibbonTitle } from "@/components/ui/ribbon";
import { Input } from "@/components/ui/input";
import { api, type Conversation, type ModelProvider, type Skill } from "@/lib/api";
import { useAppStore, modelKeyOf, requestModelOf, resolveSelectedModel, type ThemeMode } from "@/stores/app";
import { normalizeHex } from "@/lib/theme";
import { cn } from "@/lib/utils";

const DEFAULT_ACCENT = "#19c8b9";
export interface AccentPreset {
  hex: string;
  name: string;
  enName: string;
}

/** animal-island-ui 官方 13 色 NookPhone 强调色调色盘 */
const PRESET_ACCENTS: AccentPreset[] = [
  { hex: "#19c8b9", name: "薄荷青绿", enName: "Mint Teal (默认)" },
  { hex: "#82d5bb", name: "应用青", enName: "App Teal" },
  { hex: "#8ac68a", name: "应用绿", enName: "App Green" },
  { hex: "#d1da49", name: "青柠绿", enName: "Lime Green" },
  { hex: "#ecdf52", name: "黄绿色", enName: "Yellow Green" },
  { hex: "#f7cd67", name: "应用黄", enName: "App Yellow" },
  { hex: "#e59266", name: "应用橙", enName: "App Orange" },
  { hex: "#e18c6f", name: "暖桃粉", enName: "Warm Peach Pink" },
  { hex: "#fc736d", name: "应用红", enName: "App Red" },
  { hex: "#f8a6b2", name: "应用粉", enName: "App Pink" },
  { hex: "#b77dee", name: "紫色", enName: "Purple" },
  { hex: "#889df0", name: "应用蓝", enName: "App Blue" },
  { hex: "#9a835a", name: "棕色", enName: "Brown" },
];

const THEME_MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

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
    { id: "appearance", label: "外观", icon: Palette },
    { id: "data", label: "数据", icon: Database },
  ];
  const active = NAV.find((n) => n.id === activeId)?.id ?? NAV[0].id;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
      {/* 遮罩：点击关闭 */}
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" aria-hidden="true" onClick={() => setOpen(false)} />
      <div
        className="relative z-10 flex h-[min(720px,calc(100vh-48px))] w-[min(860px,calc(100vw-48px))] overflow-hidden rounded-bubble border border-island-border bg-island-card shadow-island-hover animate-float-in"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        {/* 左侧导航栏 */}
        <nav className="flex w-[188px] shrink-0 flex-col gap-4 bg-island-panel/50 px-3 pt-6">
          <div className="px-3 text-base font-extrabold text-island-ink">设置</div>
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex h-10 items-center gap-2 rounded-[14px] px-3 text-left text-sm transition-colors",
                  item.id === active ? "bg-island-card font-bold text-island-ink shadow-soft" : "font-medium text-island-muted hover:bg-island-card/70"
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
        <div className="flex min-w-0 flex-1 flex-col border-l border-island-border">
          <div className="flex h-14 shrink-0 items-center justify-end gap-2 px-4 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-island-muted transition-colors hover:bg-island-panel hover:text-island-ink"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {active === "providers" && <ProvidersSection />}
            {active === "skills" && <SkillsSection />}
            {active === "appearance" && <AppearanceSection />}
            {active === "data" && <DataSection />}
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
        <h2 className="text-base font-extrabold text-island-ink">模型提供商</h2>
        <p className="mt-0.5 text-sm leading-6 text-island-muted">先添加提供商（OpenAI 兼容端点），再在提供商内添加可选模型；聊天框下方的选择器按提供商分组切换使用哪个模型。</p>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {providers.length === 0 && (
          <div className="rounded-[16px] border-2 border-dashed border-island-borderStrong/40 px-4 py-5 text-center text-sm font-semibold text-island-muted">还没有提供商，请在下方添加一个。</div>
        )}
        {providers.map((provider) => {
          const expanded = expandedId === provider.id;
          const inUse = providerInUse(provider.id);
          return (
            <div key={provider.id} className={cn("flex flex-col gap-3 rounded-[16px] border-2 px-3.5 py-3", inUse ? "border-island-accent/50 bg-island-accentSoft/30" : "border-island-border bg-island-card/70")}>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : provider.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  title={expanded ? "收起" : "展开管理模型"}
                >
                  <ChevronDown size={15} className={cn("shrink-0 text-island-muted transition-transform", expanded && "rotate-180")} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-extrabold text-island-ink">{provider.name}</span>
                      {inUse && <span className="rounded-full bg-island-accentSoft px-2 py-px text-[11px] font-bold text-island-accentDeep">使用中</span>}
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", provider.apiKey ? "bg-island-success" : "bg-island-faint")}
                        title={provider.apiKey ? "API Key 已配置" : "未配置 API Key"}
                      />
                    </span>
                    <span className="block truncate text-xs text-island-muted">{provider.baseUrl} · {provider.models.length} 个模型</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => { if (window.confirm(`确定删除提供商「${provider.name}」及其全部模型吗？`)) { removeProvider(provider.id); if (expandedId === provider.id) setExpandedId(null); } }} className="flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-bold text-island-error transition-colors hover:bg-island-error/10" title="删除提供商"><Trash2 size={13} /> 删除</button>
                </div>
              </div>
              {expanded && (
                <div className="flex flex-col gap-3 rounded-[14px] bg-island-panel/70 p-4">
                  {provider.models.length === 0 && <div className="rounded-[12px] border-2 border-dashed border-island-borderStrong/40 px-3 py-2.5 text-center text-xs font-semibold text-island-muted">该提供商还没有模型，请在下方添加。</div>}
                  <div className="flex flex-col gap-1">
                    {provider.models.map((model) => {
                      const key = modelKeyOf(provider.id, model.id);
                      const active = key === selectedModelKey;
                      return (
                        <div key={model.id} className="flex items-center gap-2 rounded-[12px] px-2 py-1.5 hover:bg-island-card/80">
                          <button
                            type="button"
                            onClick={() => setSelectedModelKey(key)}
                            className={cn("flex min-w-0 flex-1 items-center gap-2 text-left", active && "text-island-accentDeep")}
                            title={active ? "正在使用" : "点击设为使用"}
                          >
                            <Check size={14} className={active ? "shrink-0 text-island-accentDeep" : "shrink-0 text-transparent"} />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-bold text-island-ink">{model.name}</span>
                              <span className="block truncate text-[10px] text-island-muted">{model.id}</span>
                            </span>
                          </button>
                          <button type="button" onClick={() => removeModel(provider.id, model.id)} className="rounded-[10px] p-1.5 text-island-muted hover:bg-island-error/10 hover:text-island-error" title="删除模型"><Trash2 size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-end gap-2 border-t border-island-border pt-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-island-muted">模型 ID</label>
                      <Input value={modelForm.id} onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })} placeholder="如 deepseek-chat" className="h-9 w-48 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-island-muted">显示名</label>
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

      <div className="mt-2 flex flex-col gap-3 border-t border-island-border pt-4">
        <h3 className="text-sm font-extrabold text-island-ink">添加提供商</h3>
        <p className="-mt-1 text-xs leading-5 text-island-muted">支持 OpenAI 兼容接口（如 DeepSeek、OpenAI、本地 Ollama 等）；「测试用模型 ID」仅用于测试连接，无需与后续添加的模型一致。</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-island-muted">提供商名称</label>
            <Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="如 DeepSeek" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-island-muted">Base URL</label>
            <Input value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} placeholder="如 https://api.deepseek.com/v1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-island-muted">API Key</label>
            <Input type="password" value={form.apiKey} onChange={(e) => updateForm({ apiKey: e.target.value })} placeholder="sk-…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-island-muted">测试用模型 ID（可选）</label>
            <Input value={form.testModel} onChange={(e) => updateForm({ testModel: e.target.value })} placeholder="如 deepseek-chat" />
          </div>
        </div>
        {testState && (
          <div className={cn("rounded-[14px] px-3 py-2 text-xs", testState.ok ? "bg-island-success/10 text-island-success" : "bg-island-error/10 text-island-error")}>
            <div className="flex items-center gap-1.5 font-bold">
              {testState.ok ? <Check size={13} /> : <X size={13} />}
              {testState.message}
            </div>
            {!testState.ok && testState.detail && (
              <details className="mt-1.5">
                <summary className="cursor-pointer font-semibold underline decoration-dotted">查看错误报告</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-island-ink/5 p-2 text-[10px] leading-4">{testState.detail}</pre>
              </details>
            )}
          </div>
        )}
        {notice && <div className={cn("rounded-[14px] px-3 py-2 text-xs font-semibold", notice.ok ? "bg-island-success/10 text-island-success" : "bg-island-error/10 text-island-error")}>{notice.text}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="default" onClick={testConnection} disabled={!formReady || testing}>{testing ? "测试中…" : "测试连接"}</Button>
          <Button type="button" variant="accent" onClick={saveProvider} disabled={!formReady || testing}><Settings2 size={15} /> 保存提供商</Button>
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
        <h2 className="text-base font-extrabold text-island-ink">技能</h2>
        <p className="mt-0.5 text-sm leading-6 text-island-muted">技能以 Anthropic Skills 规范存储（src/runtime/skills/{"{name}"}/SKILL.md），通过上传 .zip 技能包安装；可随时卸载与开关，开启后 agent 会在对话中按需调用。</p>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {skills.length === 0 && <div className="rounded-[16px] border-2 border-dashed border-island-borderStrong/40 px-4 py-5 text-center text-sm font-semibold text-island-muted">还没有技能，请在下方上传一个 .zip 技能包。</div>}
        {skills.map((skill) => (
          <div key={skill.name} className={cn("flex items-center gap-3 rounded-[16px] border-2 px-3.5 py-3", skill.enabled ? "border-island-lavender/40 bg-island-lavender/10" : "border-island-border bg-island-card/70 opacity-75")}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold text-island-ink">{skill.title}</span>
                <span className="text-[10px] font-bold text-island-muted">{skill.name}</span>
                <span className={cn("rounded-full px-2 py-px text-[10px] font-bold", skill.enabled ? "bg-island-success/15 text-island-success" : "bg-island-panel text-island-muted")}>{skill.enabled ? "已开启" : "已关闭"}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-island-muted">{skill.description || "（无描述）"}</p>
            </div>
            {/* Switch：track 仅 inset 阴影，handle 扁圆 + 2.5px 同色描边、无外阴影 */}
            <button
              type="button"
              onClick={() => toggle(skill)}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full shadow-[inset_0_2px_4px_rgba(61,52,40,0.18)] transition-colors duration-200 ease-island",
                skill.enabled ? "bg-island-success" : "bg-island-borderStrong/50"
              )}
              title={skill.enabled ? "点击关闭（不再被 agent 使用）" : "点击开启"}
            >
              <span
                className={cn(
                  "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-[2.5px] bg-island-card transition-all duration-200 ease-island",
                  skill.enabled ? "left-[22px] border-island-successDeep" : "left-0.5 border-island-borderStrong"
                )}
              />
            </button>
            <button type="button" onClick={() => uninstall(skill)} className="rounded-[12px] p-2 text-island-muted hover:bg-island-error/10 hover:text-island-error" title="卸载技能"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-3 border-t border-island-border pt-4">
        <h3 className="text-sm font-extrabold text-island-ink">上传 .zip 技能包</h3>
        <p className="-mt-1 text-xs leading-5 text-island-muted">压缩包内可直接放 SKILL.md（技能名取压缩包文件名），或放一个/多个技能文件夹（文件夹名即技能标识，内含大小写完全一致的 SKILL.md）。SKILL.md 使用 frontmatter 声明 name / description，可附带 scripts/ 等辅助文件。</p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-island-borderStrong/50 bg-island-card/70 px-3 py-4 text-sm font-semibold text-island-muted transition-colors hover:border-island-accent hover:text-island-accentDeep">
          <Upload size={15} /> {file ? file.name : "选择 .zip 技能包"}
          <input type="file" accept=".zip" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {message && <div className={cn("rounded-[14px] px-3 py-2 text-xs font-semibold", message.ok ? "bg-island-success/10 text-island-success" : "bg-island-error/10 text-island-error")}>{message.text}</div>}
        <div className="flex justify-end">
          <Button type="button" variant="accent" onClick={upload} disabled={busy || !file}><Wand2 size={15} /> {busy ? "安装中…" : "上传并安装"}</Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 外观：浅色/深色/跟随系统 + 主界面强调色（16 进制自定义）
 * ============================================================ */
function AppearanceSection() {
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const accentColor = useAppStore((s) => s.accentColor);
  const setAccentColor = useAppStore((s) => s.setAccentColor);
  const [hexDraft, setHexDraft] = useState(accentColor);

  // accentColor 从外部变化（预设/取色器/恢复默认）时同步草稿
  useEffect(() => {
    setHexDraft(accentColor);
  }, [accentColor]);

  const isDefault = themeMode === "light" && accentColor.toLowerCase() === DEFAULT_ACCENT;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <div>
        <h2 className="text-base font-extrabold text-island-ink">外观</h2>
        <p className="mt-0.5 text-sm leading-6 text-island-muted">切换浅色 / 深色外观；主色（强调色）会全局联动到按钮、高亮、发光与装饰，输入 16 进制色号或从调色盘 / 取色器中挑选。</p>
      </div>

      {/* 主题模式：三档分段选择 */}
      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-extrabold text-island-ink flex items-center gap-1.5"><Sun size={14} className="text-island-accentDeep" /> 主题模式</h3>
        <div className="flex rounded-full border border-island-border bg-island-panel p-1">
          {THEME_MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setThemeMode(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-bold transition-all duration-200 ease-island",
                themeMode === id
                  ? "bg-island-card text-island-ink shadow-soft"
                  : "text-island-muted hover:text-island-ink/80"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <p className="text-xs leading-5 text-island-muted">
          {themeMode === "system" ? "跟随操作系统的浅色 / 深色设置，切换系统主题时页面自动更新。" : themeMode === "dark" ? "始终使用深色外观。" : "始终使用浅色外观。"}
        </p>
      </div>

      {/* 主色：预设色卡 */}
      <div className="mt-1 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-island-ink flex items-center gap-1.5"><Palette size={14} className="text-island-accentDeep" /> 主界面颜色（13 款 NookPhone 强调色）</h3>
          <span className="text-[11px] font-bold text-island-muted">点击即换色</span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {PRESET_ACCENTS.map((preset) => {
            const active = accentColor.toLowerCase() === preset.hex.toLowerCase();
            return (
              <button
                key={preset.hex}
                type="button"
                onClick={() => setAccentColor(preset.hex)}
                title={`${preset.name} · ${preset.enName} (${preset.hex})`}
                aria-label={`选择颜色 ${preset.name} ${preset.hex}`}
                className={cn(
                  "relative h-8 w-8 rounded-full transition-transform duration-150 ease-island hover:scale-110 shadow-soft",
                  active && "ring-2 ring-island-ink/70 ring-offset-2 ring-offset-island-card"
                )}
                style={{ backgroundColor: preset.hex }}
              >
                {active && (
                  <Check size={15} className="absolute inset-0 m-auto text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]" strokeWidth={3.5} />
                )}
              </button>
            );
          })}
          {/* 原生取色器：零依赖 */}
          <label
            className="relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-island-borderStrong/60 text-island-muted transition-colors hover:border-island-accent hover:text-island-accentDeep"
            title="打开取色器（自定义任意色号）"
          >
            <Palette size={15} />
            <input
              type="color"
              value={hexDraft}
              onChange={(e) => {
                setHexDraft(e.target.value);
                setAccentColor(e.target.value);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
        <p className="text-xs leading-5 text-island-muted">支持取色器与自定义色号。</p>
      </div>

      {/* 主色：16 进制输入 */}
      <div className="mt-1 flex flex-col gap-2.5">
        <h3 className="text-sm font-extrabold text-island-ink flex items-center gap-1.5"><span className="text-island-accentDeep">#</span> 16 进制色号</h3>
        <div className="flex items-center gap-2.5">
          <Input
            value={hexDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setHexDraft(raw);
              const normalized = normalizeHex(raw);
              if (normalized) setAccentColor(normalized);
            }}
            onBlur={() => {
              const normalized = normalizeHex(hexDraft);
              setHexDraft(normalized ?? accentColor);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && normalizeHex(hexDraft)) setAccentColor(normalizeHex(hexDraft)!);
            }}
            placeholder="#19c8b9"
            className="max-w-[180px] font-mono text-sm tracking-wide"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => { setThemeMode("light"); setAccentColor(DEFAULT_ACCENT); }}
            disabled={isDefault}
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-island-borderStrong/40 px-3 py-1.5 text-[12px] font-bold transition-colors",
              isDefault
                ? "cursor-not-allowed text-island-borderStrong/60"
                : "bg-island-card text-island-muted hover:border-island-accent hover:text-island-accentDeep"
            )}
          >
            <RotateCcw size={12} /> 恢复默认
          </button>
        </div>
        <p className="text-xs leading-5 text-island-muted">支持 #rrggbb 或 #rgb（如 f0a 即 #ff00aa）；输入合法色号时实时生效，回车确认，输入框失焦自动修正格式。</p>
      </div>

      {/* 当前色预览 */}
      {(() => {
        const matchedPreset = PRESET_ACCENTS.find((p) => p.hex.toLowerCase() === accentColor.toLowerCase());
        return (
          <div className="mt-2 flex flex-col gap-3 rounded-[20px] border-2 border-island-border bg-island-card p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3 border-b border-island-border/80 pb-3">
              <div className="flex items-center gap-3">
                <span className="h-10 w-10 shrink-0 rounded-full shadow-inner ring-2 ring-island-borderStrong/30" style={{ backgroundColor: accentColor }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-island-ink">{matchedPreset ? matchedPreset.name : "自定义主色"}</span>
                    <span className="font-mono text-xs font-bold text-island-accentDeep">{accentColor.toUpperCase()}</span>
                  </div>
                  <div className="truncate text-xs text-island-muted">{matchedPreset ? matchedPreset.enName : "深色模式下会自动计算可读变体"}</div>
                </div>
              </div>
              <Badge variant="accent">全局联动中</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              <RibbonTitle color="teal" className="text-xs">飘带标题</RibbonTitle>
              <Button variant="accent" size="sm">3D 强调按钮</Button>
              <Button variant="default" size="sm">柔和按钮</Button>
              <Badge variant="accent">标签徽章</Badge>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ============================================================
 * 数据分区：导出 session log（全量备份）+ 导入（覆盖恢复 / 合并追加）
 * ============================================================ */

function DataSection() {
  const bumpConversations = useAppStore((s) => s.bumpConversations);
  const bumpCards = useAppStore((s) => s.bumpCards);
  const bumpLiteratures = useAppStore((s) => s.bumpLiteratures);
  const bumpUniverse = useAppStore((s) => s.bumpUniverse);
  const bumpPractice = useAppStore((s) => s.bumpPractice);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const providers = useAppStore((s) => s.providers);
  const selectedModelKey = useAppStore((s) => s.selectedModelKey);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const themeMode = useAppStore((s) => s.themeMode);
  const accentColor = useAppStore((s) => s.accentColor);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"restore" | "merge">("merge");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 个人配置备份：勾选的导出项
  const PROFILE_ITEMS = [
    { key: "models", label: "模型提供商（含 API Key）" },
    { key: "theme", label: "主题配色" },
    { key: "effort", label: "推理强度与选中模型" },
    { key: "practice", label: "错题本" },
    { key: "chats", label: "对话记录（含探索卡片）" },
    { key: "literature", label: "文献" },
    { key: "universe", label: "思维宇宙" },
  ] as const;
  const [profileKeys, setProfileKeys] = useState<Set<string>>(new Set(["models", "theme", "effort", "practice"]));
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function toggleProfileKey(key: string) {
    setProfileKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleExportProfile() {
    if (profileKeys.size === 0) {
      alert("请至少勾选一项要导出的内容。");
      return;
    }
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const preferences: Record<string, any> = {};
      if (profileKeys.has("models")) {
        preferences.providers = providers;
        preferences.selectedModelKey = selectedModelKey;
      }
      if (profileKeys.has("theme")) {
        preferences.themeMode = themeMode;
        preferences.accentColor = accentColor;
      }
      if (profileKeys.has("effort")) preferences.reasoningEffort = reasoningEffort;

      const data: Record<string, any> = {};
      const wantData = ["practice", "chats", "literature", "universe"].some((k) => profileKeys.has(k));
      if (wantData) {
        const full = await api.exportData();
        if (profileKeys.has("practice")) data.practice_records = full.data.practice_records;
        if (profileKeys.has("chats")) {
          data.conversations = full.data.conversations;
          data.messages = full.data.messages;
          data.explore_cards = full.data.explore_cards;
        }
        if (profileKeys.has("literature")) data.literatures = full.data.literatures;
        if (profileKeys.has("universe")) data.understandings = full.data.understandings;
      }

      const profile = {
        format: "indexnya-profile",
        version: 1,
        exported_at: new Date().toISOString(),
        preferences,
        data,
      };
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `indexnya-profile-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setProfileMessage({ ok: true, text: "已导出个人配置备份文件。" });
    } catch (e: any) {
      setProfileMessage({ ok: false, text: `导出失败：${e.message}` });
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleImportProfile() {
    if (!profileFile) {
      alert("请先选择一个个人配置备份文件（.json）。");
      return;
    }
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const text = await profileFile.text();
      const json = JSON.parse(text);
      if (json.format !== "indexnya-profile") {
        throw new Error("这不是有效的个人配置备份文件（indexnya-profile）");
      }
      // 恢复前端偏好（写入 localStorage）
      const prefs = json.preferences;
      if (prefs && typeof prefs === "object") {
        const patch: Record<string, any> = {};
        if (Array.isArray(prefs.providers)) patch.providers = prefs.providers;
        if (typeof prefs.selectedModelKey === "string") patch.selectedModelKey = prefs.selectedModelKey;
        if (prefs.themeMode) patch.themeMode = prefs.themeMode;
        if (prefs.accentColor) patch.accentColor = prefs.accentColor;
        if (prefs.reasoningEffort) patch.reasoningEffort = prefs.reasoningEffort;
        if (Object.keys(patch).length > 0) useAppStore.setState(patch);
      }
      // 恢复后端数据（合并追加）
      const hasData = json.data && typeof json.data === "object" && Object.values(json.data).some((v: any) => Array.isArray(v) && v.length > 0);
      if (hasData) {
        const result = await api.importData(profileFile, "merge");
        setProfileMessage({ ok: true, text: `已导入个人配置${result.message ? "：" + result.message : ""}` });
      } else {
        setProfileMessage({ ok: true, text: "已导入个人配置（偏好设置已恢复）。" });
      }
      bumpConversations(); bumpCards(); bumpLiteratures(); bumpUniverse(); bumpPractice();
      setProfileFile(null);
    } catch (e: any) {
      setProfileMessage({ ok: false, text: e.message });
    } finally {
      setProfileBusy(false);
    }
  }

  // 导出对话为笔记 / 导图
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [noteFormat, setNoteFormat] = useState<"both" | "notes" | "mindmap">("both");
  const [noteMode, setNoteMode] = useState<"direct" | "ai">("direct");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMessage, setNoteMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getConversations().then((rows) => {
      setConversations(rows);
      setSelectedIds(new Set(rows.filter((c) => c.parent_conversation_id == null).map((c) => c.id)));
    }).catch(() => setConversations([]));
  }, []);

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExportNotes() {
    if (selectedIds.size === 0) {
      alert("请至少勾选一个对话。");
      return;
    }
    setNoteBusy(true);
    setNoteMessage(null);
    try {
      const entry = resolveSelectedModel({ providers, selectedModelKey });
      const payload = {
        conversation_ids: [...selectedIds].sort((a, b) => a - b),
        format: noteFormat,
        mode: noteMode,
        model: noteMode === "ai" ? requestModelOf(entry) : undefined,
      };
      const result = await api.exportNotes(payload);
      const blob = new Blob([result.content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNoteMessage({ ok: true, text: `已导出 ${selectedIds.size} 个对话到 ${result.filename}` });
    } catch (e: any) {
      setNoteMessage({ ok: false, text: e.message });
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleExport() {
    setMessage(null);
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `indexnya-sessionlog-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage({ ok: true, text: "已导出 session log 文件（含全部对话、探索卡片、文献、思维宇宙与错题本）。" });
    } catch (e: any) {
      setMessage({ ok: false, text: `导出失败：${e.message}` });
    }
  }

  async function handleImport() {
    if (!file) {
      alert("请先选择一个 session log 文件（.json）。");
      return;
    }
    if (mode === "restore") {
      const ok = window.confirm("「覆盖恢复」将清空当前全部数据，并用文件内容完整还原为导出时的状态。此操作不可撤销，确定继续吗？");
      if (!ok) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.importData(file, mode);
      setMessage({ ok: true, text: result.message });
      bumpConversations();
      bumpCards();
      bumpLiteratures();
      bumpUniverse();
      bumpPractice();
      setFile(null);
      if (mode === "restore") setOpen(false);
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <div>
        <h2 className="text-base font-extrabold text-island-ink">数据</h2>
        <p className="mt-0.5 text-sm leading-6 text-island-muted">导出完整的 session log 备份文件（JSON），之后可随时导入恢复或迁移到另一台设备。</p>
      </div>

      {/* 导出 */}
      <div className="flex flex-col gap-3 rounded-[16px] border-2 border-island-border bg-island-card/70 p-4">
        <div className="flex items-center gap-2">
          <Download size={15} className="text-island-accentDeep" />
          <h3 className="text-sm font-extrabold text-island-ink">导出 session log</h3>
        </div>
        <p className="text-xs leading-5 text-island-muted">包含全部对话与消息、探索卡片树、文献、思维宇宙理解、错题本，可完美恢复聊天记录。</p>
        <div className="flex justify-end">
          <Button type="button" variant="accent" onClick={handleExport}><Download size={15} /> 导出全部数据</Button>
        </div>
      </div>

      {/* 导入 */}
      <div className="flex flex-col gap-3 rounded-[16px] border-2 border-island-border bg-island-card/70 p-4">
        <div className="flex items-center gap-2">
          <FileJson size={15} className="text-island-accentDeep" />
          <h3 className="text-sm font-extrabold text-island-ink">导入 session log</h3>
        </div>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-island-borderStrong/50 bg-island-card/70 px-3 py-3.5 text-sm font-semibold text-island-muted transition-colors hover:border-island-accent hover:text-island-accentDeep">
          <Upload size={15} /> {file ? file.name : "选择 session log 文件（.json）"}
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMessage(null); }} />
        </label>

        {/* 导入模式 */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-island-muted">导入方式</span>
          <label className="flex items-start gap-2.5 rounded-[14px] border border-island-border bg-island-card px-3 py-2.5 cursor-pointer">
            <input type="radio" name="import-mode" checked={mode === "merge"} onChange={() => setMode("merge")} className="mt-0.5 accent-[var(--island-accent)]" />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-island-ink">合并追加（推荐）</span>
              <span className="block text-xs text-island-muted">保留现有数据，导入内容作为新数据加入，不影响已有记录。</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-[14px] border border-island-border bg-island-card px-3 py-2.5 cursor-pointer">
            <input type="radio" name="import-mode" checked={mode === "restore"} onChange={() => setMode("restore")} className="mt-0.5 accent-[var(--island-accent)]" />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-island-ink">覆盖恢复</span>
              <span className="block text-xs text-island-muted">清空当前全部数据，用文件内容完整还原（保留原始对话结构）。</span>
            </span>
          </label>
        </div>

        {message && (
          <div className={cn("rounded-[14px] px-3 py-2 text-xs font-semibold", message.ok ? "bg-island-success/10 text-island-success" : "bg-island-error/10 text-island-error")}>
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="accent" onClick={handleImport} disabled={busy || !file}>
            <Upload size={15} /> {busy ? "导入中…" : mode === "restore" ? "覆盖恢复" : "合并导入"}
          </Button>
        </div>
      </div>

      {/* 导出对话为笔记 / 思维导图 */}
      <div className="flex flex-col gap-3 rounded-[16px] border-2 border-island-border bg-island-card/70 p-4">
        <div className="flex items-center gap-2">
          <NotebookPen size={15} className="text-island-accentDeep" />
          <h3 className="text-sm font-extrabold text-island-ink">导出对话为笔记 / 思维导图</h3>
        </div>
        <p className="text-xs leading-5 text-island-muted">勾选要导出的对话，选择文件形式与生成方式，导出为 Markdown 文件。</p>

        {/* 对话多选 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-island-muted">选择对话（{selectedIds.size} 个）</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelectedIds(new Set(conversations.map((c) => c.id)))} className="text-[11px] font-bold text-island-accentDeep hover:underline">全选</button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[11px] font-bold text-island-muted hover:underline">清空</button>
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto rounded-[14px] border border-island-border bg-island-panel/50 p-1.5">
            {conversations.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs font-semibold text-island-muted">还没有对话</div>
            ) : (
              conversations.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-island-card">
                  <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="accent-[var(--island-accent)]" />
                  <span className="min-w-0 flex-1 truncate text-xs text-island-ink">{c.title}</span>
                  {c.parent_conversation_id != null && <span className="shrink-0 text-[10px] text-island-lavender">分支</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {/* 文件形式 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-island-muted">文件形式</span>
          <div className="flex flex-wrap gap-1.5">
            {([["both", "笔记 + 导图"], ["notes", "仅笔记"], ["mindmap", "仅思维导图"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setNoteFormat(value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-bold transition-colors",
                  noteFormat === value ? "border-island-accent bg-island-accentSoft text-island-accentDeep" : "border-island-border bg-island-card text-island-muted hover:text-island-ink"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 生成方式 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-island-muted">生成方式</span>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2.5 rounded-[14px] border border-island-border bg-island-card px-3 py-2 cursor-pointer">
              <input type="radio" name="note-mode" checked={noteMode === "direct"} onChange={() => setNoteMode("direct")} className="mt-0.5 accent-[var(--island-accent)]" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-island-ink">直接整理（推荐）</span>
                <span className="block text-xs text-island-muted">不调模型，忠实整理对话原文，稳定快速。</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-[14px] border border-island-border bg-island-card px-3 py-2 cursor-pointer">
              <input type="radio" name="note-mode" checked={noteMode === "ai"} onChange={() => setNoteMode("ai")} className="mt-0.5 accent-[var(--island-accent)]" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-island-ink">AI 提炼</span>
                <span className="block text-xs text-island-muted">调用当前模型提炼知识点结构，更精炼（需模型、较慢）。</span>
              </span>
            </label>
          </div>
        </div>

        {noteMessage && (
          <div className={cn("rounded-[14px] px-3 py-2 text-xs font-semibold", noteMessage.ok ? "bg-island-success/10 text-island-success" : "bg-island-error/10 text-island-error")}>
            {noteMessage.text}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="accent" onClick={handleExportNotes} disabled={noteBusy || selectedIds.size === 0}>
            <Download size={15} /> {noteBusy ? "导出中…" : "导出笔记 / 导图"}
          </Button>
        </div>
      </div>

      {/* 个人配置备份 */}
      <div className="flex flex-col gap-3 rounded-[16px] border-2 border-island-border bg-island-card/70 p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-island-accentDeep" />
          <h3 className="text-sm font-extrabold text-island-ink">个人配置备份</h3>
        </div>
        <p className="text-xs leading-5 text-island-muted">勾选要备份的内容，导出为 JSON 文件；导入时偏好设置（模型/主题/推理强度）直接恢复，数据部分合并追加。</p>

        {/* 勾选项 */}
        <div className="grid grid-cols-2 gap-1.5">
          {PROFILE_ITEMS.map((item) => (
            <label key={item.key} className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-island-panel">
              <input type="checkbox" checked={profileKeys.has(item.key)} onChange={() => toggleProfileKey(item.key)} className="accent-[var(--island-accent)]" />
              <span className="text-xs text-island-ink">{item.label}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] leading-4 text-island-muted">提示：模型提供商包含 API Key，导出文件含敏感信息，请勿外传。</p>

        {/* 导入文件选择 */}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-island-borderStrong/50 bg-island-card/70 px-3 py-3 text-sm font-semibold text-island-muted transition-colors hover:border-island-accent hover:text-island-accentDeep">
          <Upload size={15} /> {profileFile ? profileFile.name : "选择个人配置备份文件（.json）"}
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { setProfileFile(e.target.files?.[0] ?? null); setProfileMessage(null); }} />
        </label>

        {profileMessage && (
          <div className={cn("rounded-[14px] px-3 py-2 text-xs font-semibold", profileMessage.ok ? "bg-island-success/10 text-island-success" : "bg-island-error/10 text-island-error")}>
            {profileMessage.text}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="default" onClick={handleImportProfile} disabled={profileBusy || !profileFile}>
            <Upload size={15} /> {profileBusy ? "导入中…" : "导入配置"}
          </Button>
          <Button type="button" variant="accent" onClick={handleExportProfile} disabled={profileBusy || profileKeys.size === 0}>
            <Download size={15} /> {profileBusy ? "导出中…" : "导出配置"}
          </Button>
        </div>
      </div>
    </div>
  );
}
