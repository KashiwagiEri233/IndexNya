import type { Database } from "./db.ts";
import { json, nowIso, parseJson, toNumber } from "./db.ts";
import { HttpError } from "./errors.ts";
import { chatCompleteText, hasUsableModel } from "./llm.ts";
import { listConversations, listLiteratures, listMessages, listPractice, listUnderstandings, listCards, rowToConversation, rowToMessage } from "./repository.ts";
import type { JsonObject, ModelConfig } from "./types.ts";

export const SESSION_FORMAT = "indexnya-sessionlog";
export const PROFILE_FORMAT = "indexnya-profile";
export const SESSION_VERSION = 1;

function dateValue(value: unknown): string {
  if (!value) return nowIso();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

export function exportData(db: Database, studentId: number): JsonObject {
  const conversations = listConversations(db, studentId);
  const conversationIds = conversations.map((item) => item.id);
  const messages = conversationIds.length ? conversationIds.flatMap((id) => listMessages(db, id)).sort((a, b) => a.id - b.id) : [];
  const cards = listCards(db, studentId).sort((a, b) => a.id - b.id);
  const literatures = listLiteratures(db, studentId).sort((a, b) => a.id - b.id);
  const understandings = listUnderstandings(db, studentId).sort((a, b) => a.id - b.id);
  const practice = listPractice(db, studentId, "all").sort((a, b) => a.id - b.id);
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    exported_at: nowIso(),
    data: {
      conversations: conversations.map((item) => ({ id: item.id, title: item.title, parent_conversation_id: item.parent_conversation_id, created_at: item.created_at })),
      messages: messages.map((item) => ({ id: item.id, conversation_id: item.conversation_id, role: item.role, content: item.content, meta: item.meta, created_at: item.created_at })),
      explore_cards: cards.map((item) => ({ id: item.id, conversation_id: item.conversation_id, parent_card_id: item.parent_card_id, source_message_id: item.source_message_id, type: item.type, term: item.term, context: item.context, branch_conversation_id: item.branch_conversation_id, content: item.content, status: item.status, created_at: item.created_at })),
      literatures: literatures.map((item) => ({ id: item.id, title: item.title, source_type: item.source_type, text: item.text, terms: item.terms, meta: item.meta, created_at: item.created_at })),
      understandings: understandings.map((item) => ({ id: item.id, concept: item.concept, summary: item.summary, ai_score: item.ai_score, ai_feedback: item.ai_feedback, status: item.status, embedding: item.embedding, anchors: item.anchors, source: item.source, created_at: item.created_at })),
      practice_records: practice.map((item) => ({ id: item.id, conversation_id: item.conversation_id, topic: item.topic, question: item.question, options: item.options, answer: item.answer, explanation: item.explanation, is_correct: item.is_correct, asked_at: item.asked_at, answered_at: item.answered_at })),
    },
  };
}

function payloadData(input: unknown): Record<string, unknown[]> {
  if (!input || typeof input !== "object") throw new HttpError(400, "session log 数据格式错误");
  const result: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) result[key] = Array.isArray(value) ? value : [];
  return result;
}

function intId(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function maxId(db: Database, table: string): number {
  const allowed = new Set(["conversations", "messages", "explore_cards"]);
  if (!allowed.has(table)) throw new Error("invalid table");
  return toNumber(db.get<Record<string, unknown>>(`SELECT MAX(id) AS max_id FROM ${table}`)?.max_id, 0);
}

function clearStudentData(db: Database, studentId: number): void {
  const conversations = db.all<Record<string, unknown>>("SELECT id FROM conversations WHERE student_id = ?", [studentId]).map((row) => toNumber(row.id));
  db.run("DELETE FROM explore_cards WHERE student_id = ?", [studentId]);
  if (conversations.length) {
    const p = conversations.map(() => "?").join(",");
    db.run(`DELETE FROM messages WHERE conversation_id IN (${p})`, conversations);
    db.run(`DELETE FROM practice_records WHERE student_id = ?`, [studentId]);
    db.run(`DELETE FROM conversations WHERE id IN (${p})`, conversations);
  }
  db.run("DELETE FROM literatures WHERE student_id = ?", [studentId]);
  db.run("DELETE FROM understandings WHERE student_id = ?", [studentId]);
  if (!conversations.length) db.run("DELETE FROM practice_records WHERE student_id = ?", [studentId]);
}

function insertRestore(db: Database, studentId: number, data: Record<string, unknown[]>): Record<string, number> {
  const now = nowIso();
  const conversations = data.conversations || [];
  for (const raw of conversations) {
    const item = raw as Record<string, unknown>; const id = intId(item.id); if (!id) continue;
    db.run("INSERT INTO conversations (id, student_id, title, parent_conversation_id, created_at) VALUES (?, ?, ?, ?, ?)", [id, studentId, String(item.title || "新对话").slice(0, 128), intId(item.parent_conversation_id) ?? null, dateValue(item.created_at || now)]);
  }
  for (const raw of data.messages || []) {
    const item = raw as Record<string, unknown>; const id = intId(item.id); const conversationId = intId(item.conversation_id); if (!id || !conversationId) continue;
    db.run("INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, conversationId, String(item.role || "user"), String(item.content || ""), json(item.meta || {}), dateValue(item.created_at || now)]);
  }
  for (const raw of data.explore_cards || []) {
    const item = raw as Record<string, unknown>; const id = intId(item.id); if (!id) continue;
    db.run("INSERT INTO explore_cards (id, student_id, conversation_id, parent_card_id, source_message_id, type, term, context, branch_conversation_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, studentId, intId(item.conversation_id) ?? null, intId(item.parent_card_id) ?? null, intId(item.source_message_id) ?? null, String(item.type || "child"), String(item.term || "").slice(0, 128), String(item.context || ""), intId(item.branch_conversation_id) ?? null, item.content == null ? null : json(item.content), String(item.status || "completed"), dateValue(item.created_at || now)]);
  }
  for (const raw of data.literatures || []) {
    const item = raw as Record<string, unknown>;
    db.run("INSERT INTO literatures (student_id, title, source_type, text, terms, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [studentId, String(item.title || "未命名").slice(0, 256), String(item.source_type || "txt"), String(item.text || ""), json(item.terms || []), json(item.meta || {}), dateValue(item.created_at || now)]);
  }
  for (const raw of data.understandings || []) {
    const item = raw as Record<string, unknown>;
    db.run("INSERT INTO understandings (student_id, concept, summary, ai_score, ai_feedback, status, embedding, anchors, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [studentId, String(item.concept || "").slice(0, 128), String(item.summary || ""), Number(item.ai_score || 0), String(item.ai_feedback || ""), String(item.status || "approved"), json(item.embedding || []), json(item.anchors || []), json(item.source || {}), dateValue(item.created_at || now)]);
  }
  for (const raw of data.practice_records || []) {
    const item = raw as Record<string, unknown>;
    db.run("INSERT INTO practice_records (student_id, conversation_id, topic, question, options, answer, explanation, is_correct, asked_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [studentId, intId(item.conversation_id) ?? null, String(item.topic || "").slice(0, 128), String(item.question || ""), json(item.options || []), String(item.answer || ""), String(item.explanation || ""), item.is_correct === null || item.is_correct === undefined ? null : (item.is_correct ? 1 : 0), dateValue(item.asked_at || now), item.answered_at ? dateValue(item.answered_at) : null]);
  }
  return {
    conversations: conversations.length,
    messages: (data.messages || []).length,
    explore_cards: (data.explore_cards || []).length,
    literatures: (data.literatures || []).length,
    understandings: (data.understandings || []).length,
    practice_records: (data.practice_records || []).length,
  };
}

function insertMerge(db: Database, studentId: number, data: Record<string, unknown[]>): Record<string, number> {
  const conversations = data.conversations || []; const messages = data.messages || []; const cards = data.explore_cards || [];
  const convMap = new Map<number, number>(); const msgMap = new Map<number, number>(); const cardMap = new Map<number, number>();
  let nextConv = maxId(db, "conversations") + 1; let nextMsg = maxId(db, "messages") + 1; let nextCard = maxId(db, "explore_cards") + 1;
  for (const raw of conversations) { const id = intId((raw as Record<string, unknown>).id); if (id && !convMap.has(id)) convMap.set(id, nextConv++); }
  for (const raw of messages) { const id = intId((raw as Record<string, unknown>).id); if (id && !msgMap.has(id)) msgMap.set(id, nextMsg++); }
  for (const raw of cards) { const id = intId((raw as Record<string, unknown>).id); if (id && !cardMap.has(id)) cardMap.set(id, nextCard++); }
  const now = nowIso();
  for (const raw of conversations) {
    const item = raw as Record<string, unknown>; const old = intId(item.id); const id = old ? convMap.get(old) : undefined; if (!id) continue;
    const parent = intId(item.parent_conversation_id); db.run("INSERT INTO conversations (id, student_id, title, parent_conversation_id, created_at) VALUES (?, ?, ?, ?, ?)", [id, studentId, String(item.title || "新对话").slice(0, 128), parent ? convMap.get(parent) ?? null : null, dateValue(item.created_at || now)]);
  }
  for (const raw of messages) {
    const item = raw as Record<string, unknown>; const old = intId(item.id); const id = old ? msgMap.get(old) : undefined; const conversation = intId(item.conversation_id); const newConversation = conversation ? convMap.get(conversation) : undefined; if (!id || !newConversation) continue;
    const meta = parseJson<JsonObject>(item.meta, {}); if (meta.branched_from && convMap.has(Number(meta.branched_from))) meta.branched_from = convMap.get(Number(meta.branched_from));
    db.run("INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, newConversation, String(item.role || "user"), String(item.content || ""), json(meta), dateValue(item.created_at || now)]);
  }
  for (const raw of cards) {
    const item = raw as Record<string, unknown>; const old = intId(item.id); const id = old ? cardMap.get(old) : undefined; if (!id) continue;
    const conv = intId(item.conversation_id); const parent = intId(item.parent_card_id); const source = intId(item.source_message_id); const branch = intId(item.branch_conversation_id);
    db.run("INSERT INTO explore_cards (id, student_id, conversation_id, parent_card_id, source_message_id, type, term, context, branch_conversation_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, studentId, conv ? convMap.get(conv) ?? null : null, parent ? cardMap.get(parent) ?? null : null, source ? msgMap.get(source) ?? null : null, String(item.type || "child"), String(item.term || "").slice(0, 128), String(item.context || ""), branch ? convMap.get(branch) ?? null : null, item.content == null ? null : json(item.content), String(item.status || "completed"), dateValue(item.created_at || now)]);
  }
  for (const raw of data.literatures || []) { const item = raw as Record<string, unknown>; db.run("INSERT INTO literatures (student_id, title, source_type, text, terms, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [studentId, String(item.title || "未命名").slice(0, 256), String(item.source_type || "txt"), String(item.text || ""), json(item.terms || []), json(item.meta || {}), dateValue(item.created_at || now)]); }
  for (const raw of data.understandings || []) { const item = raw as Record<string, unknown>; db.run("INSERT INTO understandings (student_id, concept, summary, ai_score, ai_feedback, status, embedding, anchors, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [studentId, String(item.concept || "").slice(0, 128), String(item.summary || ""), Number(item.ai_score || 0), String(item.ai_feedback || ""), String(item.status || "approved"), json(item.embedding || []), json(item.anchors || []), json(item.source || {}), dateValue(item.created_at || now)]); }
  for (const raw of data.practice_records || []) { const item = raw as Record<string, unknown>; const conv = intId(item.conversation_id); db.run("INSERT INTO practice_records (student_id, conversation_id, topic, question, options, answer, explanation, is_correct, asked_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [studentId, conv ? convMap.get(conv) ?? null : null, String(item.topic || "").slice(0, 128), String(item.question || ""), json(item.options || []), String(item.answer || ""), String(item.explanation || ""), item.is_correct === null || item.is_correct === undefined ? null : (item.is_correct ? 1 : 0), dateValue(item.asked_at || now), item.answered_at ? dateValue(item.answered_at) : null]); }
  return { conversations: conversations.length, messages: messages.length, explore_cards: cards.length, literatures: (data.literatures || []).length, understandings: (data.understandings || []).length, practice_records: (data.practice_records || []).length };
}

export function importData(db: Database, studentId: number, input: unknown, mode: "restore" | "merge" = "merge"): JsonObject {
  if (!input || typeof input !== "object" || ![SESSION_FORMAT, PROFILE_FORMAT].includes(String((input as Record<string, unknown>).format))) throw new HttpError(400, "不是有效的 IndexNya session log / 个人配置文件");
  const data = payloadData((input as Record<string, unknown>).data);
  const stats = db.withoutForeignKeys(() => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = mode === "restore" ? (clearStudentData(db, studentId), insertRestore(db, studentId, data)) : insertMerge(db, studentId, data);
      db.exec("COMMIT");
      return result;
    } catch (error) { try { db.exec("ROLLBACK"); } catch { /* noop */ } throw error; }
  });
  return { mode, message: mode === "restore" ? "已覆盖恢复：导入的聊天记录已完整还原为导出时的状态。" : "已合并追加：导入内容已作为新数据加入，不影响现有记录。", imported: stats };
}

function plain(value: string): string { return (value || "").replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~\[\](){}|!\-]/g, " ").replace(/\s+/g, " ").trim(); }
function summarize(value: string, limit: number): string { const text = plain(value); return text.length > limit ? `${text.slice(0, limit)}…` : text || "（空）"; }

function directNotes(conversations: ReturnType<typeof listConversations>, byConversation: Map<number, ReturnType<typeof listMessages>>): string {
  const parts = ["# IndexNya 学习笔记", "", `> 导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })} · 共 ${conversations.length} 个对话`, ""];
  for (const conversation of conversations) {
    parts.push(`## ${conversation.title}`, "");
    const messages = byConversation.get(conversation.id) || [];
    if (!messages.length) { parts.push("（无消息）", ""); continue; }
    for (const message of messages) {
      if (message.role === "user") parts.push(`**问：** ${message.content.trim()}`, "");
      else { parts.push("**答：**", "", message.content.trim(), ""); }
    }
  }
  return `${parts.join("\n").trim()}\n`;
}

function directMindmap(conversations: ReturnType<typeof listConversations>, byConversation: Map<number, ReturnType<typeof listMessages>>): string {
  const lines = ["mindmap", "  root((IndexNya 学习笔记))"];
  for (const conversation of conversations) {
    lines.push(`    ${summarize(conversation.title, 20)}`);
    let question: ReturnType<typeof listMessages>[number] | undefined;
    for (const message of byConversation.get(conversation.id) || []) {
      if (message.role === "user") question = message;
      else if (message.role === "assistant") { lines.push(`      ${summarize(question?.content || "（问题）", 20)}`, `        ${summarize(message.content, 24)}`); question = undefined; }
    }
    if (question) lines.push(`      ${summarize(question.content, 20)}`);
  }
  return lines.join("\n");
}

async function aiNotes(conversations: ReturnType<typeof listConversations>, byConversation: Map<number, ReturnType<typeof listMessages>>, model?: ModelConfig): Promise<{ notes: string; mindmap: string }> {
  if (!hasUsableModel(model)) return { notes: "", mindmap: "" };
  const dialog = conversations.map((conversation) => [`【对话：${conversation.title}】`, ...(byConversation.get(conversation.id) || []).map((message) => `${message.role === "user" ? "问" : "答"}：${message.content.slice(0, 4000)}`)].join("\n")).join("\n").slice(0, 30000);
  const raw = await chatCompleteText(model, [{ role: "system", content: "你是严谨的学习内容整理助手，只输出 JSON。" }, { role: "user", content: `把下面的对话整理成 JSON：{"notes":"Markdown","mindmap":"mermaid mindmap 源码"}\n${dialog}` }], { temperature: 0.3, maxTokens: 6000 });
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { notes: "", mindmap: "" };
  try { const data = JSON.parse(raw.slice(start, end + 1)) as JsonObject; return { notes: String(data.notes || ""), mindmap: String(data.mindmap || "") }; } catch { return { notes: "", mindmap: "" }; }
}

export async function exportNotes(db: Database, conversationIds: number[], format: "both" | "notes" | "mindmap" = "both", mode: "direct" | "ai" = "direct", model?: ModelConfig): Promise<{ filename: string; content: string }> {
  if (!conversationIds.length) throw new HttpError(400, "请至少选择一个对话");
  const all = conversationIds.map((id) => db.get<Record<string, unknown>>("SELECT * FROM conversations WHERE id = ?", [id])).filter(Boolean).map((row) => rowToConversation(row!));
  if (!all.length) throw new HttpError(400, "未找到所选对话");
  const byConversation = new Map(all.map((conversation) => [conversation.id, listMessages(db, conversation.id).filter((message) => ["user", "assistant"].includes(message.role))]));
  let notes: string; let mindmap: string;
  if (mode === "ai") { const result = await aiNotes(all, byConversation, model); notes = result.notes; mindmap = result.mindmap; if (!notes && !mindmap) throw new HttpError(400, "AI 提炼失败：模型未返回有效内容，请稍后重试或改用「直接整理」"); }
  else { notes = directNotes(all, byConversation); mindmap = directMindmap(all, byConversation); }
  const blocks: string[] = []; if ((format === "both" || format === "notes") && notes) blocks.push(notes); if ((format === "both" || format === "mindmap") && mindmap) blocks.push(`\n---\n\n## 思维导图\n\n\`\`\`mermaid\n${mindmap}\n\`\`\`\n`);
  const content = `${blocks.join("\n").trim()}\n`; if (!content.trim()) throw new HttpError(400, "没有可导出的内容");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
  return { filename: `indexnya-notes-${stamp}.md`, content };
}
