/** 全局状态 — 当前学生 / 当前对话 / 资源刷新信号 / 探索卡片坞。 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatModel, ChatTerm, ExploreMode, Student } from "@/lib/api";
import { api } from "@/lib/api";

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
  student: Student | null;
  setStudent: (s: Student | null) => void;
  ensureStudent: () => Promise<Student>;

  // 当前对话 id，持久化到 localStorage，刷新不丢
  convId: number | null;
  setConvId: (id: number | null) => void;

  // 前端可自行维护的 OpenAI 兼容模型列表
  models: ChatModel[];
  selectedModelId: string;
  selectedImageModelId: string;
  addModel: (model: ChatModel) => void;
  removeModel: (id: string) => void;
  setSelectedModelId: (id: string) => void;
  setSelectedImageModelId: (id: string) => void;

  // 触发资源/路径/画像刷新的计数器
  resourceVersion: number;
  bumpResources: () => void;
  profileVersion: number;
  bumpProfile: () => void;
  pathVersion: number;
  bumpPath: () => void;
  conversationVersion: number;
  bumpConversations: () => void;
  cardVersion: number;
  bumpCards: () => void;
  literatureVersion: number;
  bumpLiteratures: () => void;
  universeVersion: number;
  bumpUniverse: () => void;

  // 从对话带入思维宇宙的候选理解（跨页传递，不持久化）
  pendingInsight: { concept: string; summary: string } | null;
  setPendingInsight: (v: { concept: string; summary: string } | null) => void;

  // 探索卡片坞（层级对话）
  exploreCards: ExploreCardState[];
  exploreAdd: (card: ExploreCardState) => void;
  explorePatch: (key: string, patch: Partial<ExploreCardState>) => void;
  exploreRemove: (key: string) => void;
  exploreClose: (key: string) => void;
  exploreCloseAll: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      student: null,
      setStudent: (s) => set({ student: s }),
      ensureStudent: async () => {
        const cur = get().student;
        if (cur) return cur;
        const list = await api.listStudents();
        if (list.length > 0) {
          set({ student: list[0] });
          return list[0];
        }
        const s = await api.createStudent("新用户");
        set({ student: s });
        return s;
      },

      convId: null,
      setConvId: (id) => set({ convId: id }),

      models: [],
      selectedModelId: "",
      selectedImageModelId: "",
      addModel: (model) => set((state) => {
        const models = [...state.models.filter((item) => item.id !== model.id), model];
        return {
          models,
          selectedModelId: model.type === "image" ? state.selectedModelId : model.id,
          selectedImageModelId: model.type === "image" ? model.id : state.selectedImageModelId,
        };
      }),
      removeModel: (id) => set((state) => {
        const models = state.models.filter((model) => model.id !== id);
        const nextSelected = state.selectedModelId === id ? (models.find((model) => model.type !== "image")?.id ?? "") : state.selectedModelId;
        const nextImage = state.selectedImageModelId === id ? (models.find((model) => model.type === "image")?.id ?? "") : state.selectedImageModelId;
        return { models, selectedModelId: nextSelected, selectedImageModelId: nextImage };
      }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      setSelectedImageModelId: (id) => set({ selectedImageModelId: id }),

      resourceVersion: 0,
      bumpResources: () => set({ resourceVersion: Date.now() }),
      profileVersion: 0,
      bumpProfile: () => set({ profileVersion: Date.now() }),
      pathVersion: 0,
      bumpPath: () => set({ pathVersion: Date.now() }),
      conversationVersion: 0,
      bumpConversations: () => set({ conversationVersion: Date.now() }),
      cardVersion: 0,
      bumpCards: () => set({ cardVersion: Date.now() }),
      literatureVersion: 0,
      bumpLiteratures: () => set({ literatureVersion: Date.now() }),
      universeVersion: 0,
      bumpUniverse: () => set({ universeVersion: Date.now() }),

      pendingInsight: null,
      setPendingInsight: (v) => set({ pendingInsight: v }),

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
    }),
    {
      name: "learning-agent-store",
      // 持久化当前对话和浏览器本地模型配置；学生对象每次从后端拉取
      partialize: (s) => ({ convId: s.convId, models: s.models, selectedModelId: s.selectedModelId, selectedImageModelId: s.selectedImageModelId }),
      // 清理旧版本遗留的内置模型，避免升级后继续出现在选择器中。
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<AppState>;
        const models = (persisted.models || []).filter((model) => Boolean(model.baseUrl || model.apiKey)).map((model) => ({ ...model, type: model.type === "image" ? ("image" as const) : ("chat" as const) }));
        const chatModels = models.filter((model) => model.type !== "image");
        const imageModels = models.filter((model) => model.type === "image");
        const selectedModelId = chatModels.some((model) => model.id === persisted.selectedModelId)
          ? persisted.selectedModelId || ""
          : (chatModels[0]?.id || "");
        const selectedImageModelId = imageModels.some((model) => model.id === persisted.selectedImageModelId)
          ? persisted.selectedImageModelId || ""
          : (imageModels[0]?.id || "");
        return { ...currentState, ...persisted, models, selectedModelId, selectedImageModelId };
      },
    }
  )
);
