/** 全局状态 — 当前对话 / 模型提供商 / 探索卡片坞（本地单用户）。 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatTerm, ExploreMode, ModelPayload, ModelProvider, ProviderModel } from "@/lib/api";

/** 模型推理强度（与 pi-ai 级别一致，随请求透传；off = 不传参由接口默认）。 */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** 主题模式：浅色 / 深色 / 跟随系统。 */
export type ThemeMode = "light" | "dark" | "system";

/** 选中模型的 key：`{providerId}::{modelId}`（供消息/卡片记录与请求组合）。 */
export function modelKeyOf(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

/** 解析 key 为 (providerId, modelId)；格式非法返回 null。 */
export function splitModelKey(key: string): { providerId: string; modelId: string } | null {
  const index = key.indexOf("::");
  if (index <= 0 || index === key.length - 2) return null;
  return { providerId: key.slice(0, index), modelId: key.slice(index + 2) };
}

/** 一个已解析的选中模型（提供商 + 其下模型）。 */
export interface SelectedModelEntry {
  provider: ModelProvider;
  model: ProviderModel;
  key: string;
}

/** 按模型 key 解析出提供商条目；key 缺失/非法时返回 undefined。 */
export function resolveModelEntry(
  providers: readonly ModelProvider[],
  key?: string | null,
): SelectedModelEntry | undefined {
  if (!key) return undefined;
  const parts = splitModelKey(key);
  if (!parts) return undefined;
  const provider = providers.find((p) => p.id === parts.providerId);
  if (!provider) return undefined;
  const model = provider.models.find((m) => m.id === parts.modelId);
  if (!model) return undefined;
  return { provider, model, key };
}

/** 当前选中的模型条目；无选中时取第一个提供商的首个模型。 */
export function resolveSelectedModel(state: { providers: readonly ModelProvider[]; selectedModelKey: string }): SelectedModelEntry | undefined {
  return (
    resolveModelEntry(state.providers, state.selectedModelKey)
    ?? (state.providers[0]?.models[0] ? { provider: state.providers[0], model: state.providers[0].models[0], key: modelKeyOf(state.providers[0].id, state.providers[0].models[0].id) } : undefined)
  );
}

/** 组合成后端请求的 model payload（OpenAI 兼容：name/model/base_url/api_key + 推理强度）。 */
export function requestModelOf(entry: SelectedModelEntry | undefined) {
  if (!entry) return undefined;
  const payload: ModelPayload = {
    id: entry.key,
    name: entry.model.name,
    model: entry.model.id,
    base_url: entry.provider.baseUrl,
    api_key: entry.provider.apiKey,
  };
  // 推理强度随请求透传（off 时不传，由接口默认）
  const effort = useAppStore.getState().reasoningEffort;
  if (effort !== "off") payload.reasoning_effort = effort;
  return payload;
}

/** 一张打开的探索卡片（层级对话）。 */
export interface ExploreCardState {
  key: string;
  cardId?: number;
  term: string;
  explanation?: string;
  context: string;
  mode: ExploreMode;
  conversationId?: number;
  branchConversationId?: number;
  sourceMessageId?: number;
  parentCardId?: number;
  parentKey?: string;
  modelId?: string;
  status: "pending" | "opening" | "streaming" | "done" | "error";
  messages: { role: "user" | "assistant"; content: string; streaming?: boolean; terms?: ChatTerm[] }[];
  error?: string;
  /** 关闭动画进行中 */
  closing?: boolean;
}

interface AppState {
  // 当前对话 id，持久化到 localStorage，刷新不丢
  convId: number | null;
  setConvId: (id: number | null) => void;

  // 模型提供商列表（每个提供商下可选多个模型）；配置存 localStorage
  providers: ModelProvider[];
  selectedModelKey: string;
  addProvider: (provider: ModelProvider) => void;
  removeProvider: (id: string) => void;
  addModel: (providerId: string, model: ProviderModel) => void;
  removeModel: (providerId: string, modelId: string) => void;
  setSelectedModelKey: (key: string) => void;

  // 设置弹窗（会话级，不持久化）
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // 模型推理强度（off/minimal/low/medium/high/xhigh/max），随每次 LLM 请求透传
  reasoningEffort: ReasoningLevel;
  setReasoningEffort: (effort: ReasoningLevel) => void;

  // 外观主题：模式（浅色/深色/跟随系统）+ 主色（十六进制，默认薄荷青绿 #19c8b9）
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentColor: string;
  setAccentColor: (hex: string) => void;

  // 触发对话/卡片/文献/宇宙/错题本刷新的计数器
  conversationVersion: number;
  bumpConversations: () => void;
  cardVersion: number;
  bumpCards: () => void;
  literatureVersion: number;
  bumpLiteratures: () => void;
  universeVersion: number;
  bumpUniverse: () => void;
  practiceVersion: number;
  bumpPractice: () => void;

  // 从对话带入思维宇宙的候选理解（跨页传递，不持久化）
  pendingInsight: { concept: string; summary: string } | null;
  setPendingInsight: (v: { concept: string; summary: string } | null) => void;

  // 错题本「重练错题」跨页传递到对话页（不持久化）
  pendingPracticeMessage: { text: string } | null;
  setPendingPracticeMessage: (v: { text: string } | null) => void;

  // 探索卡片坞（层级对话）
  exploreCards: ExploreCardState[];
  exploreAdd: (card: ExploreCardState) => void;
  explorePatch: (key: string, patch: Partial<ExploreCardState>) => void;
  exploreRemove: (key: string) => void;
  exploreClose: (key: string) => void;
  exploreCloseAll: () => void;
  /** 卡片树导航：聚焦某张卡片（临时高亮置顶，便于精准定位） */
  focusCardKey: string | null;
  exploreFocus: (key: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      convId: null,
      setConvId: (id) => set({ convId: id }),

      providers: [],
      selectedModelKey: "",
      addProvider: (provider) => set((state) => {
        const providers = [...state.providers.filter((p) => p.id !== provider.id), provider];
        // 保存即用：新提供商若带模型，选中它的第一个模型
        const selectedModelKey = provider.models[0] ? modelKeyOf(provider.id, provider.models[0].id) : state.selectedModelKey;
        return { providers, selectedModelKey };
      }),
      removeProvider: (id) => set((state) => {
        const providers = state.providers.filter((p) => p.id !== id);
        const nextSelected = state.selectedModelKey.startsWith(`${id}::`)
          ? (resolveSelectedModel({ providers, selectedModelKey: "" })?.key ?? "")
          : state.selectedModelKey;
        return { providers, selectedModelKey: nextSelected };
      }),
      addModel: (providerId, model) => set((state) => {
        const providers = state.providers.map((p) => {
          if (p.id !== providerId) return p;
          const models = [...p.models.filter((m) => m.id !== model.id), model];
          return { ...p, models };
        });
        const provider = providers.find((p) => p.id === providerId);
        // 该提供商原先没有可选模型 → 自动选中新模型
        const selectedModelKey = provider && provider.models.length === 1
          ? modelKeyOf(providerId, model.id)
          : state.selectedModelKey;
        return { providers, selectedModelKey };
      }),
      removeModel: (providerId, modelId) => set((state) => {
        const providers = state.providers.map((p) =>
          p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p
        );
        const removedKey = modelKeyOf(providerId, modelId);
        const nextSelected = state.selectedModelKey === removedKey
          ? (resolveSelectedModel({ providers, selectedModelKey: "" })?.key ?? "")
          : state.selectedModelKey;
        return { providers, selectedModelKey: nextSelected };
      }),
      setSelectedModelKey: (key) => set({ selectedModelKey: key }),

      settingsOpen: false,
      setSettingsOpen: (open) => set({ settingsOpen: open }),

      reasoningEffort: "off",
      setReasoningEffort: (effort) => set({ reasoningEffort: effort }),

      themeMode: "light",
      setThemeMode: (mode) => set({ themeMode: mode }),
      accentColor: "#19c8b9",
      setAccentColor: (hex) => set({ accentColor: hex }),

      // 触发对话/错题本等刷新的计数器
      conversationVersion: 0,
      bumpConversations: () => set({ conversationVersion: Date.now() }),
      cardVersion: 0,
      bumpCards: () => set({ cardVersion: Date.now() }),
      literatureVersion: 0,
      bumpLiteratures: () => set({ literatureVersion: Date.now() }),
      universeVersion: 0,
      bumpUniverse: () => set({ universeVersion: Date.now() }),
      practiceVersion: 0,
      bumpPractice: () => set({ practiceVersion: Date.now() }),

      pendingInsight: null,
      setPendingInsight: (v) => set({ pendingInsight: v }),

      pendingPracticeMessage: null,
      setPendingPracticeMessage: (v) => set({ pendingPracticeMessage: v }),

      exploreCards: [],
      exploreAdd: (card) => set((state) => ({ exploreCards: [...state.exploreCards, card] })),
      explorePatch: (key, patch) => set((state) => ({
        exploreCards: state.exploreCards.map((c) => (c.key === key ? { ...c, ...patch } : c)),
      })),
      exploreRemove: (key) => set((state) => ({
        exploreCards: state.exploreCards.filter((c) => c.key !== key),
      })),
      exploreClose: (key) => {
        set((state) => ({
          exploreCards: state.exploreCards.map((c) => (c.key === key ? { ...c, closing: true } : c)),
        }));
        setTimeout(() => {
          get().exploreRemove(key);
        }, 200);
      },
      exploreCloseAll: () => {
        set((state) => ({
          exploreCards: state.exploreCards.map((c) => ({ ...c, closing: true })),
        }));
        setTimeout(() => {
          set({ exploreCards: [] });
        }, 200);
      },

      focusCardKey: null,
      exploreFocus: (key) => {
        set({ focusCardKey: key });
        if (key) {
          setTimeout(() => set({ focusCardKey: null }), 1800);
        }
      },
    }),
    {
      name: "learning-agent-store",
      // 持久化当前对话和浏览器本地的模型提供商配置；学生对象每次从后端拉取
      partialize: (s) => ({ convId: s.convId, providers: s.providers, selectedModelKey: s.selectedModelKey, reasoningEffort: s.reasoningEffort, themeMode: s.themeMode, accentColor: s.accentColor }),
      // 兼容旧版本：扁平 models 列表 → 每个旧模型迁移为一个独立提供商（保留 baseUrl/apiKey/模型）
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<AppState> & { models?: unknown[]; selectedModelId?: unknown };
        let providers = persisted.providers ?? [];
        let selectedModelKey = persisted.selectedModelKey ?? "";
        const legacyModels = Array.isArray(persisted.models) ? persisted.models : [];
        if (legacyModels.length > 0 && (!Array.isArray(providers) || providers.length === 0)) {
          providers = legacyModels
            .filter((m: any) => Boolean(m.baseUrl || m.apiKey) && m.type !== "image")
            .map((m: any) => ({
              id: String(m.id),
              name: String(m.name || m.model || "未命名提供商"),
              baseUrl: m.baseUrl || "",
              apiKey: m.apiKey || "",
              models: [{ id: String(m.model), name: String(m.name || m.model) }],
            }));
          const legacySelected = String(persisted.selectedModelId ?? "");
          const match = providers.find((p) => p.id === legacySelected && p.models[0]);
          selectedModelKey = match ? modelKeyOf(match.id, match.models[0].id) : "";
        }
        if (!Array.isArray(providers)) providers = [];
        if (!selectedModelKey) {
          selectedModelKey = resolveSelectedModel({ providers, selectedModelKey: "" })?.key ?? "";
        }
        return { ...currentState, ...persisted, providers, selectedModelKey };
      },
    }
  )
);
