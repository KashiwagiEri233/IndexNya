/** 全局状态 — 当前对话 / 模型 / 探索卡片坞（本地单用户）。 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatModel, ChatTerm, ExploreMode } from "@/lib/api";

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

  // 前端可自行维护的 OpenAI 兼容模型列表
  models: ChatModel[];
  selectedModelId: string;
  addModel: (model: ChatModel) => void;
  removeModel: (id: string) => void;
  setSelectedModelId: (id: string) => void;

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

      models: [],
      selectedModelId: "",
      addModel: (model) => set((state) => {
        const models = [...state.models.filter((item) => item.id !== model.id), model];
        return {
          models,
          selectedModelId: model.type === "image" ? state.selectedModelId : model.id,
        };
      }),
      removeModel: (id) => set((state) => {
        const models = state.models.filter((model) => model.id !== id);
        const nextSelected = state.selectedModelId === id ? (models.find((model) => model.type !== "image")?.id ?? "") : state.selectedModelId;
        return { models, selectedModelId: nextSelected };
      }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),

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
      // 持久化当前对话和浏览器本地模型配置；学生对象每次从后端拉取
      partialize: (s) => ({ convId: s.convId, models: s.models, selectedModelId: s.selectedModelId }),
      // 清理旧版本遗留的内置模型和图片模型，避免升级后继续出现在选择器中。
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<AppState>;
        const models = (persisted.models || []).filter((model) => Boolean(model.baseUrl || model.apiKey) && model.type !== "image").map((model) => ({ ...model, type: "chat" as const }));
        const selectedModelId = models.some((model) => model.id === persisted.selectedModelId)
          ? persisted.selectedModelId || ""
          : (models[0]?.id || "");
        return { ...currentState, ...persisted, models, selectedModelId };
      },
    }
  )
);
