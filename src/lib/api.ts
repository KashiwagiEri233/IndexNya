/** 后端 API 客户端 — 普通 fetch + SSE 流式封装（本地单用户，无需 student_id）。 */

export const API_BASE = "/api";

export interface Message {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  meta?: Record<string, any>;
  created_at: string;
}

/** 提供商内可选的一个模型。 */
export interface ProviderModel {
  /** 模型标识（发给 API 的 model id，如 deepseek-chat） */
  id: string;
  /** 显示名 */
  name: string;
}

/** 一个模型提供商（OpenAI 兼容端点），其下可配置多个可选模型。 */
export interface ModelProvider {
  /** 提供商标识（稳定 id，如 deepseek / custom-openai） */
  id: string;
  /** 提供商显示名 */
  name: string;
  /** OpenAI 兼容端点 */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 该提供商下的可选模型列表 */
  models: ProviderModel[];
}

export interface ChatTerm {
  text: string;
  explanation?: string;
  /** background=理解所需背景知识（点开默认子卡片）；related=横向对比概念（默认关联卡片） */
  relation?: "background" | "related";
}

export interface Conversation {
  id: number;
  student_id: number;
  title: string;
  parent_conversation_id?: number | null;
  created_at: string;
}

export interface Resource {
  id: number;
  student_id: number;
  type: string;
  title: string;
  content: Record<string, any>;
  file_url: string | null;
  status: string;
  created_at: string;
}

export interface Skill {
  name: string;
  title: string;
  description: string;
  enabled: boolean;
}

export interface PracticeRecord {
  id: number;
  student_id: number;
  conversation_id: number | null;
  topic: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  is_correct: boolean | null;
  asked_at: string;
  answered_at: string | null;
}

/** 探索卡片（层级对话） */
export type ExploreMode = "child" | "related" | "branch";

export interface CardRow {
  id: number;
  student_id: number;
  conversation_id: number | null;
  parent_card_id: number | null;
  source_message_id: number | null;
  type: ExploreMode;
  term: string;
  context: string;
  branch_conversation_id: number | null;
  content?: {
    question?: string;
    messages?: { role: string; content: string; terms?: ChatTerm[] }[];
  } | null;
  status: string;
  created_at: string;
}

export type ModelPayload = { id?: string; name?: string; model: string; base_url?: string; api_key?: string; type?: string; reasoning_effort?: string };

export interface ExploreCardPayload {
  term: string;
  explanation?: string;
  context?: string;
  mode: ExploreMode;
  conversation_id?: number;
  source_message_id?: number;
  parent_card_id?: number;
  card_id?: number;
  seed_message?: string;
  model?: ModelPayload;
}

export interface Literature {
  id: number;
  student_id: number;
  title: string;
  source_type: string;
  terms: ChatTerm[];
  created_at: string;
}

export interface LiteratureDetail extends Literature {
  text: string;
}

export interface Understanding {
  id: number;
  student_id: number;
  concept: string;
  summary: string;
  ai_score: number;
  ai_feedback: string;
  anchors: { concept: string; summary: string }[];
  created_at: string;
}

export interface UniverseGraph {
  nodes: { id: string; concept: string; summary: string; score: number; size: number }[];
  links: { source: string; target: string; weight: number }[];
}

export interface AnchorItem {
  id: number;
  concept: string;
  summary: string;
  score: number;
  similarity: number;
}

async function j<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${t}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  async health() {
    return j<{ status: string; app_name: string }>(
      await fetch(`${API_BASE}/health`)
    );
  },

  async getConversations() {
    return j<Conversation[]>(
      await fetch(`${API_BASE}/conversations`)
    );
  },

  async testModelConnection(model: ModelPayload) {
    return j<{ ok: boolean; model: string; message: string; preview?: string; detail?: string }>(
      await fetch(`${API_BASE}/models/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      })
    );
  },

  async deleteConversation(conversationId: number) {
    return j<{ deleted_ids: number[] }>(
      await fetch(`${API_BASE}/conversations/${conversationId}`, { method: "DELETE" })
    );
  },

  async branchConversation(conversationId: number, title?: string) {
    return j<Conversation & { branched_from: number }>(
      await fetch(`${API_BASE}/conversations/${conversationId}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(title ? { title } : {}),
      })
    );
  },

  async getMessages(conversationId: number) {
    return j<any[]>(
      await fetch(`${API_BASE}/conversations/${conversationId}/messages`)
    );
  },

  async listPractice(filter: "all" | "wrong" | "right" | "pending" = "all") {
    return j<PracticeRecord[]>(await fetch(`${API_BASE}/practice?filter=${filter}`));
  },

  async deletePractice(recordId: number) {
    return j<{ deleted_id: number }>(
      await fetch(`${API_BASE}/practice/${recordId}`, { method: "DELETE" })
    );
  },

  async clearPractice() {
    return j<{ deleted_count: number }>(
      await fetch(`${API_BASE}/practice`, { method: "DELETE" })
    );
  },

  async generateResource(payload: {
    type: string;
    topic: string;
    conversation_id?: number;
    extra?: Record<string, any>;
    model?: ModelPayload;
  }) {
    return j<Resource>(
      await fetch(`${API_BASE}/resources/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async tutorAsk(payload: {
    question: string;
    context_resource_id?: number;
    modality?: string;
  }) {
    return j<any>(
      await fetch(`${API_BASE}/tutor/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async understandImage(
    image: File,
    question: string,
    model?: ModelPayload,
  ): Promise<{
    recognition: string | null;
    answer: string | null;
    question: string;
    status: string;
    error: string | null;
  }> {
    const form = new FormData();
    form.append("question", question);
    form.append("image", image);
    if (model) form.append("model", JSON.stringify(model));
    const resp = await fetch(`${API_BASE}/image/understand`, {
      method: "POST",
      body: form,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`image understand failed: ${resp.status} ${t}`);
    }
    return resp.json();
  },

  async listSkills() {
    return j<Skill[]>(await fetch(`${API_BASE}/skills`));
  },

  /** 上传 .zip 技能包安装（zip 内可直接放 SKILL.md，或放一个/多个技能文件夹）。 */
  async installSkill(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return j<{ names: string[]; message: string }>(
      await fetch(`${API_BASE}/skills`, { method: "POST", body: fd })
    );
  },

  async deleteSkill(name: string) {
    return j<{ name: string; status: string }>(
      await fetch(`${API_BASE}/skills/${name}`, { method: "DELETE" })
    );
  },

  async setSkillEnabled(name: string, enabled: boolean) {
    return j<{ name: string; enabled: boolean }>(
      await fetch(`${API_BASE}/skills/${name}/enabled`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
    );
  },

  /** SSE 流式对话。回调接收事件。 */
  async chatStream(
    payload: {
      conversation_id?: number;
      message: string;
      resource_type?: string;
      mode?: string;
      model?: ModelPayload;
      context?: string;
    },
    handlers: {
      onMeta?: (d: any) => void;
      onRoute?: (d: any) => void;
      onToken?: (t: string) => void;
      onResource?: (d: any) => void;
      onSkill?: (d: any) => void;
      onQuiz?: (d: any) => void;
      onTerms?: (d: any) => void;
      onPlan?: (d: any) => void;
      onProgress?: (d: any) => void;
      onAcceptance?: (d: any) => void;
      onDone?: (d: any) => void;
      onError?: (m: string) => void;
    },
    signal?: AbortSignal
  ) {
    const resp = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`chat failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() || "";
      for (const ev of events) {
        const lines = ev.split("\n");
        let event = "message";
        let data = "";
        for (const ln of lines) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        if (!data) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        switch (event) {
          case "meta":
            handlers.onMeta?.(parsed);
            break;
          case "route":
            handlers.onRoute?.(parsed);
            break;
          case "token":
            handlers.onToken?.(parsed.text);
            break;
          case "resource":
            handlers.onResource?.(parsed);
            break;
          case "skill":
            handlers.onSkill?.(parsed);
            break;
          case "quiz":
            handlers.onQuiz?.(parsed);
            break;
          case "terms":
            handlers.onTerms?.(parsed);
            break;
          case "plan":
            handlers.onPlan?.(parsed);
            break;
          case "progress":
            handlers.onProgress?.(parsed);
            break;
          case "acceptance":
            handlers.onAcceptance?.(parsed);
            break;
          case "done":
            handlers.onDone?.(parsed);
            break;
          case "error":
            handlers.onError?.(parsed.message);
            break;
        }
      }
    }
  },

  /** SSE 流式生成一张探索卡片（层级对话）。 */
  async exploreCard(
    payload: ExploreCardPayload,
    handlers: {
      onMeta?: (d: any) => void;
      onToken?: (t: string) => void;
      onTerms?: (d: any) => void;
      onDone?: (d: any) => void;
      onError?: (m: string) => void;
    },
    signal?: AbortSignal
  ) {
    const resp = await fetch(`${API_BASE}/hierarchy/explore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok || !resp.body) {
      if (resp.status === 404) {
        throw new Error("后端接口不存在（/api/hierarchy/explore）。请确认后端已更新到最新代码并重启服务（Ctrl+C 后重新 ./start.sh）。");
      }
      throw new Error(`explore failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() || "";
      for (const ev of events) {
        const lines = ev.split("\n");
        let event = "message";
        let data = "";
        for (const ln of lines) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        if (!data) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        switch (event) {
          case "meta":
            handlers.onMeta?.(parsed);
            break;
          case "token":
            handlers.onToken?.(parsed.text);
            break;
          case "terms":
            handlers.onTerms?.(parsed);
            break;
          case "done":
            handlers.onDone?.(parsed);
            break;
          case "error":
            handlers.onError?.(parsed.message);
            break;
        }
      }
    }
  },

  // ===== 探索卡片（卡片树） =====
  async listCards() {
    return j<CardRow[]>(await fetch(`${API_BASE}/hierarchy/cards`));
  },

  async deleteCard(cardId: number) {
    return j<{ deleted_ids: number[] }>(
      await fetch(`${API_BASE}/hierarchy/cards/${cardId}`, { method: "DELETE" })
    );
  },

  // ===== 消息编辑 / 删除 =====
  async updateMessage(messageId: number, content: string) {
    return j<Message>(
      await fetch(`${API_BASE}/messages/${messageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
    );
  },

  async deleteMessage(messageId: number, scope: "message" | "round" = "round") {
    return j<{ deleted_ids: number[] }>(
      await fetch(`${API_BASE}/messages/${messageId}?scope=${scope}`, { method: "DELETE" })
    );
  },

  // ===== 文献导入 =====
  async uploadLiterature(file: File) {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(`${API_BASE}/literature/upload`, { method: "POST", body: form });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`upload failed: ${resp.status} ${t}`);
    }
    return resp.json() as Promise<Literature>;
  },

  async extractLiteratureTerms(literatureId: number, model?: ModelPayload) {
    return j<Literature>(
      await fetch(`${API_BASE}/literature/${literatureId}/terms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model ? { model } : {}),
      })
    );
  },

  async listLiteratures() {
    return j<Literature[]>(await fetch(`${API_BASE}/literature`));
  },

  async getLiterature(literatureId: number) {
    return j<LiteratureDetail>(await fetch(`${API_BASE}/literature/${literatureId}`));
  },

  async deleteLiterature(literatureId: number) {
    return j<{ id: number; status: string }>(
      await fetch(`${API_BASE}/literature/${literatureId}`, { method: "DELETE" })
    );
  },

  // ===== 思维宇宙 =====
  async evaluateUnderstanding(payload: {
    concept: string;
    summary: string;
    model?: ModelPayload;
  }) {
    return j<{
      approved: boolean;
      score: number;
      feedback: string;
      missing: string[];
      understanding?: Understanding;
    }>(
      await fetch(`${API_BASE}/universe/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async getUniverse() {
    return j<Understanding[]>(await fetch(`${API_BASE}/universe`));
  },

  async getUniverseGraph() {
    return j<UniverseGraph>(await fetch(`${API_BASE}/universe/graph`));
  },

  async getAnchors(topic: string) {
    return j<{ topic: string; anchors: AnchorItem[] }>(
      await fetch(`${API_BASE}/universe/anchors?topic=${encodeURIComponent(topic)}`)
    );
  },

  async deleteUnderstanding(understandingId: number) {
    return j<{ id: number; status: string }>(
      await fetch(`${API_BASE}/universe/${understandingId}`, { method: "DELETE" })
    );
  },

  // ===== 数据导出 / 导入（session log 备份与恢复） =====
  async exportData() {
    return j<{ format: string; version: number; exported_at: string; data: Record<string, any[]> }>(
      await fetch(`${API_BASE}/data/export`)
    );
  },

  async importData(file: File, mode: "restore" | "merge") {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    const resp = await fetch(`${API_BASE}/data/import`, { method: "POST", body: form });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`导入失败：${resp.status} ${t}`);
    }
    return resp.json() as Promise<{ mode: string; message: string; imported: Record<string, number> }>;
  },

  /** 把选中对话导出为笔记 / 思维导图（markdown）。 */
  async exportNotes(payload: {
    conversation_ids: number[];
    format: "both" | "notes" | "mindmap";
    mode: "direct" | "ai";
    model?: ModelPayload;
  }) {
    return j<{ filename: string; content: string }>(
      await fetch(`${API_BASE}/data/export-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },
};