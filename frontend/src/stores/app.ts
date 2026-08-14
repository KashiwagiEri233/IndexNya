/** 全局状态 — 当前学生 / 当前对话 / 资源刷新信号。 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatModel, Student } from "@/lib/api";
import { api } from "@/lib/api";

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
  addModel: (model: ChatModel) => void;
  removeModel: (id: string) => void;
  setSelectedModelId: (id: string) => void;

  // 触发资源/路径/画像刷新的计数器
  resourceVersion: number;
  bumpResources: () => void;
  profileVersion: number;
  bumpProfile: () => void;
  pathVersion: number;
  bumpPath: () => void;
  conversationVersion: number;
  bumpConversations: () => void;
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
      addModel: (model) => set((state) => ({
        models: [...state.models.filter((item) => item.id !== model.id), model],
        selectedModelId: model.id,
      })),
      removeModel: (id) => set((state) => {
        const models = state.models.filter((model) => model.id !== id);
        const nextSelected = state.selectedModelId === id ? (models[0]?.id ?? "") : state.selectedModelId;
        return { models, selectedModelId: nextSelected };
      }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),

      resourceVersion: 0,
      bumpResources: () => set({ resourceVersion: Date.now() }),
      profileVersion: 0,
      bumpProfile: () => set({ profileVersion: Date.now() }),
      pathVersion: 0,
      bumpPath: () => set({ pathVersion: Date.now() }),
      conversationVersion: 0,
      bumpConversations: () => set({ conversationVersion: Date.now() }),
    }),
    {
      name: "learning-agent-store",
      // 持久化当前对话和浏览器本地模型配置；学生对象每次从后端拉取
      partialize: (s) => ({ convId: s.convId, models: s.models, selectedModelId: s.selectedModelId }),
      // 清理旧版本遗留的内置模型，避免升级后继续出现在选择器中。
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<AppState>;
        const models = (persisted.models || []).filter((model) => Boolean(model.baseUrl || model.apiKey));
        const selectedModelId = models.some((model) => model.id === persisted.selectedModelId)
          ? persisted.selectedModelId || ""
          : (models[0]?.id || "");
        return { ...currentState, ...persisted, models, selectedModelId };
      },
    }
  )
);
