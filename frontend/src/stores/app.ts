/** 全局状态 — 当前学生 / 当前对话 / 资源刷新信号。 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Student } from "@/lib/api";
import { api } from "@/lib/api";

interface AppState {
  student: Student | null;
  setStudent: (s: Student | null) => void;
  ensureStudent: () => Promise<Student>;

  // 当前对话 id，持久化到 localStorage，刷新不丢
  convId: number | null;
  setConvId: (id: number | null) => void;

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
      // 只持久化 convId（学生对象每次从后端拉取，避免不同浏览器不同步）
      partialize: (s) => ({ convId: s.convId }),
    }
  )
);
