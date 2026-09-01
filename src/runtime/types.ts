/** Shared domain types for the TypeScript full-stack runtime. */

export type JsonObject = Record<string, unknown>;
export type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

export interface ModelConfig {
  id?: string;
  name?: string;
  type?: string;
  model: string;
  base_url?: string;
  api_key?: string;
  reasoning_effort?: string;
}

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  role: ChatRole | string;
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface StudentRow {
  id: number;
  name: string;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  student_id: number;
  title: string;
  parent_conversation_id: number | null;
  created_at: string;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  meta: JsonObject;
  created_at: string;
}

export interface ResourceRow {
  id: number;
  student_id: number;
  conversation_id: number | null;
  type: string;
  title: string;
  content: JsonObject;
  file_url: string | null;
  status: string;
  meta: JsonObject;
  created_at: string;
}

export interface ExploreCardRow {
  id: number;
  student_id: number;
  conversation_id: number | null;
  parent_card_id: number | null;
  source_message_id: number | null;
  type: "child" | "related" | "branch" | string;
  term: string;
  context: string;
  branch_conversation_id: number | null;
  content: JsonObject | null;
  status: string;
  created_at: string;
}

export interface LiteratureRow {
  id: number;
  student_id: number;
  title: string;
  source_type: string;
  text: string;
  terms: Array<Record<string, string>>;
  meta: JsonObject;
  created_at: string;
}

export interface UnderstandingRow {
  id: number;
  student_id: number;
  concept: string;
  summary: string;
  ai_score: number;
  ai_feedback: string;
  status: string;
  embedding: number[];
  anchors: Array<Record<string, string>>;
  source: JsonObject;
  created_at: string;
}

export interface PracticeRecordRow {
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

export interface ChatRequest {
  conversation_id?: number;
  student_id?: number;
  message: string;
  resource_type?: string;
  mode?: string;
  model?: ModelConfig;
  context?: string;
}

export interface ExploreRequest {
  student_id?: number;
  term: string;
  explanation?: string;
  context?: string;
  mode?: string;
  conversation_id?: number;
  source_message_id?: number;
  parent_card_id?: number;
  card_id?: number;
  seed_message?: string;
  model?: ModelConfig;
}

export interface SseEvent {
  event: string;
  data: unknown;
}
