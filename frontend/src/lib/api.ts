/** 后端 API 客户端 — 普通 fetch + SSE 流式封装。 */

export const API_BASE = "/api";

export interface Student {
  id: number;
  name: string;
  created_at: string;
}

export interface Profile {
  id: number;
  student_id: number;
  version: number;
  dimensions: Record<string, any>;
  raw_summary: string;
  created_at: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  meta?: Record<string, any>;
  created_at: string;
}

export interface ChatModel {
  id: string;
  name: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  type?: "chat" | "image";
}

export interface ChatTerm {
  text: string;
  explanation?: string;
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

export interface LearningPath {
  id: number;
  student_id: number;
  goal: string;
  nodes: PathNode[];
  version: number;
  created_at: string;
}

export interface PathNode {
  step: number;
  title: string;
  description: string;
  resource_types: string[];
  resource_ids: number[];
  estimated_hours: number;
  depends_on: number[];
  checkpoint: string;
}

export interface AssessmentDashboard {
  student_id: number;
  dimensions: { name: string; key: string; score: number; evidence: string }[];
  total_score: number;
  recommendation: string;
  raw_stats?: Record<string, any>;
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
    return j<{ status: string; llm_ready: boolean }>(
      await fetch(`${API_BASE}/health`)
    );
  },

  async createStudent(name = "新用户") {
    return j<Student>(
      await fetch(`${API_BASE}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    );
  },

  async listStudents() {
    return j<Student[]>(await fetch(`${API_BASE}/students`));
  },

  async getProfile(studentId: number) {
    const r = await fetch(`${API_BASE}/profile/${studentId}`);
    if (r.status === 404) return null;
    return j<Profile>(r);
  },

  async getConversations(studentId: number) {
    return j<Conversation[]>(
      await fetch(`${API_BASE}/conversations?student_id=${studentId}`)
    );
  },

  async testModelConnection(model: { id?: string; name?: string; model: string; base_url?: string; api_key?: string; type?: "chat" | "image" }) {
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

  async listResources(studentId: number, type?: string) {
    const q = new URLSearchParams({ student_id: String(studentId) });
    if (type) q.set("type", type);
    return j<Resource[]>(await fetch(`${API_BASE}/resources?${q}`));
  },

  async generateResource(payload: {
    student_id: number;
    type: string;
    topic: string;
    conversation_id?: number;
    extra?: Record<string, any>;
    model?: { id?: string; name?: string; model: string; base_url?: string; api_key?: string; type?: "chat" | "image" };
    image_model?: { id?: string; name?: string; model: string; base_url?: string; api_key?: string; type?: "chat" | "image" };
  }) {
    return j<Resource>(
      await fetch(`${API_BASE}/resources/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async planPath(studentId: number, goal: string) {
    return j<LearningPath>(
      await fetch(`${API_BASE}/paths/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, goal }),
      })
    );
  },

  async getPath(studentId: number) {
    const r = await fetch(`${API_BASE}/paths/${studentId}`);
    if (r.status === 404) return null;
    return j<LearningPath | null>(r);
  },

  async tutorAsk(payload: {
    student_id: number;
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
    studentId: number,
    image: File,
    question: string,
  ): Promise<{
    recognition: string | null;
    answer: string | null;
    question: string;
    status: string;
    error: string | null;
  }> {
    const form = new FormData();
    form.append("student_id", String(studentId));
    form.append("question", question);
    form.append("image", image);
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

  async trackProgress(payload: {
    student_id: number;
    resource_id?: number;
    status: string;
    score?: number;
    time_spent_min?: number;
    feedback?: string;
  }) {
    return j<{ id: number; status: string }>(
      await fetch(`${API_BASE}/assessment/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
  },

  async getAssessment(studentId: number) {
    return j<AssessmentDashboard>(
      await fetch(`${API_BASE}/assessment/${studentId}`)
    );
  },

  /** SSE 流式对话。回调接收事件。 */
  async chatStream(
    payload: {
      conversation_id?: number;
      student_id?: number;
      message: string;
      resource_type?: string;
      mode?: string;
      model?: { id?: string; name?: string; model: string; base_url?: string; api_key?: string; type?: "chat" | "image" };
      image_model?: { id?: string; name?: string; model: string; base_url?: string; api_key?: string; type?: "chat" | "image" };
      context?: string;
    },
    handlers: {
      onMeta?: (d: any) => void;
      onRoute?: (d: any) => void;
      onToken?: (t: string) => void;
      onProfile?: (d: any) => void;
      onResource?: (d: any) => void;
      onTerms?: (d: any) => void;
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
          case "profile":
            handlers.onProfile?.(parsed);
            break;
          case "resource":
            handlers.onResource?.(parsed);
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
};
