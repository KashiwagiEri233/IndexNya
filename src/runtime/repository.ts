import type { Database } from "./db.ts";
import { boolToSql, json, nowIso, parseJson, sqlToBool, toNumber } from "./db.ts";
import { HttpError } from "./errors.ts";
import type {
  ConversationRow,
  ExploreCardRow,
  JsonObject,
  LiteratureRow,
  MessageRow,
  PracticeRecordRow,
  ResourceRow,
  StudentRow,
  UnderstandingRow,
} from "./types.ts";
import { rowToUnderstanding } from "./universe.ts";

function text(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function nullableNumber(value: unknown): number | null { return value === null || value === undefined || value === "" ? null : toNumber(value); }

export function rowToStudent(row: Record<string, unknown>): StudentRow {
  return { id: toNumber(row.id), name: text(row.name, "同学"), created_at: text(row.created_at, nowIso()) };
}

export function rowToConversation(row: Record<string, unknown>): ConversationRow {
  return { id: toNumber(row.id), student_id: toNumber(row.student_id), title: text(row.title, "新对话"), parent_conversation_id: nullableNumber(row.parent_conversation_id), created_at: text(row.created_at, nowIso()) };
}

export function rowToMessage(row: Record<string, unknown>): MessageRow {
  return { id: toNumber(row.id), conversation_id: toNumber(row.conversation_id), role: text(row.role, "user"), content: text(row.content), meta: parseJson<JsonObject>(row.meta, {}), created_at: text(row.created_at, nowIso()) };
}

export function rowToResource(row: Record<string, unknown>): ResourceRow {
  return { id: toNumber(row.id), student_id: toNumber(row.student_id), conversation_id: nullableNumber(row.conversation_id), type: text(row.type), title: text(row.title), content: parseJson<JsonObject>(row.content, {}), file_url: row.file_url === null || row.file_url === undefined ? null : String(row.file_url), status: text(row.status, "completed"), meta: parseJson<JsonObject>(row.meta, {}), created_at: text(row.created_at, nowIso()) };
}

export function rowToCard(row: Record<string, unknown>): ExploreCardRow {
  return { id: toNumber(row.id), student_id: toNumber(row.student_id), conversation_id: nullableNumber(row.conversation_id), parent_card_id: nullableNumber(row.parent_card_id), source_message_id: nullableNumber(row.source_message_id), type: text(row.type, "child"), term: text(row.term), context: text(row.context), branch_conversation_id: nullableNumber(row.branch_conversation_id), content: row.content === null || row.content === undefined ? null : parseJson<JsonObject | null>(row.content, null), status: text(row.status, "completed"), created_at: text(row.created_at, nowIso()) };
}

export function rowToLiterature(row: Record<string, unknown>): LiteratureRow {
  return { id: toNumber(row.id), student_id: toNumber(row.student_id), title: text(row.title), source_type: text(row.source_type, "txt"), text: text(row.text), terms: parseJson<Array<Record<string, string>>>(row.terms, []), meta: parseJson<JsonObject>(row.meta, {}), created_at: text(row.created_at, nowIso()) };
}

export function rowToPractice(row: Record<string, unknown>): PracticeRecordRow {
  return { id: toNumber(row.id), student_id: toNumber(row.student_id), conversation_id: nullableNumber(row.conversation_id), topic: text(row.topic), question: text(row.question), options: parseJson<string[]>(row.options, []), answer: text(row.answer), explanation: text(row.explanation), is_correct: sqlToBool(row.is_correct), asked_at: text(row.asked_at, nowIso()), answered_at: row.answered_at === null || row.answered_at === undefined ? null : String(row.answered_at) };
}

export function getLocalStudent(db: Database): StudentRow {
  const existing = db.get<Record<string, unknown>>("SELECT * FROM students ORDER BY id ASC LIMIT 1");
  if (existing) return rowToStudent(existing);
  const inserted = db.run("INSERT INTO students (name, created_at) VALUES (?, ?)", ["本地用户", nowIso()]);
  return rowToStudent(db.get<Record<string, unknown>>("SELECT * FROM students WHERE id = ?", [inserted.lastInsertRowid])!);
}

export function getConversation(db: Database, id: number): ConversationRow | undefined {
  const row = db.get<Record<string, unknown>>("SELECT * FROM conversations WHERE id = ?", [id]);
  return row ? rowToConversation(row) : undefined;
}

export function listConversations(db: Database, studentId: number): ConversationRow[] {
  const rows = db.all<Record<string, unknown>>("SELECT * FROM conversations WHERE student_id = ? ORDER BY created_at DESC, id DESC", [studentId]);
  return rows.map((row) => {
    const conversation = rowToConversation(row);
    if (conversation.parent_conversation_id === null) {
      const first = db.get<Record<string, unknown>>("SELECT meta FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 1", [conversation.id]);
      const meta = parseJson<JsonObject>(first?.meta, {});
      conversation.parent_conversation_id = nullableNumber(meta.branched_from);
    }
    return conversation;
  });
}

export function listMessages(db: Database, conversationId: number): MessageRow[] {
  return db.all<Record<string, unknown>>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC", [conversationId]).map(rowToMessage);
}

export function insertMessage(db: Database, values: { conversationId: number; role: string; content: string; meta?: JsonObject; createdAt?: string }): MessageRow {
  const inserted = db.run("INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)", [values.conversationId, values.role, values.content, json(values.meta || {}), values.createdAt || nowIso()]);
  return rowToMessage(db.get<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [inserted.lastInsertRowid])!);
}

export function createConversation(db: Database, studentId: number, title: string, parentId: number | null = null): ConversationRow {
  const inserted = db.run("INSERT INTO conversations (student_id, title, parent_conversation_id, created_at) VALUES (?, ?, ?, ?)", [studentId, title.slice(0, 128) || "新对话", parentId, nowIso()]);
  return rowToConversation(db.get<Record<string, unknown>>("SELECT * FROM conversations WHERE id = ?", [inserted.lastInsertRowid])!);
}

export function branchConversation(db: Database, sourceId: number, title?: string, studentId?: number): ConversationRow {
  const source = getConversation(db, sourceId);
  if (!source) throw new HttpError(404, "conversation not found");
  if (studentId !== undefined && source.student_id !== studentId) throw new HttpError(403, "conversation does not belong to student");
  const branch = createConversation(db, source.student_id, (title || `侧边：${source.title}`).slice(0, 128), source.id);
  for (const message of listMessages(db, source.id)) {
    insertMessage(db, { conversationId: branch.id, role: message.role, content: message.content, meta: { ...message.meta, branched_from: source.id }, createdAt: message.created_at });
  }
  return getConversation(db, branch.id)!;
}

function conversationTreeIds(db: Database, root: ConversationRow): number[] {
  const all = db.all<Record<string, unknown>>("SELECT * FROM conversations WHERE student_id = ?", [root.student_id]).map(rowToConversation);
  const parentById = new Map<number, number | null>();
  for (const conversation of all) {
    let parent = conversation.parent_conversation_id;
    if (parent === null) {
      const first = db.get<Record<string, unknown>>("SELECT meta FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 1", [conversation.id]);
      parent = nullableNumber(parseJson<JsonObject>(first?.meta, {}).branched_from);
    }
    parentById.set(conversation.id, parent);
  }
  const ids = [root.id];
  for (let index = 0; index < ids.length; index += 1) {
    for (const [id, parent] of parentById) if (parent === ids[index] && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function deleteConversationTree(db: Database, conversationId: number, studentId?: number): number[] {
  const root = getConversation(db, conversationId);
  if (!root) throw new HttpError(404, "conversation not found");
  if (studentId !== undefined && root.student_id !== studentId) throw new HttpError(403, "conversation does not belong to student");
  const ids = conversationTreeIds(db, root);
  db.withoutForeignKeys(() => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const placeholders = ids.map(() => "?").join(",");
      db.run(`UPDATE resources SET conversation_id = NULL WHERE conversation_id IN (${placeholders})`, ids);
      db.run(`UPDATE practice_records SET conversation_id = NULL WHERE conversation_id IN (${placeholders})`, ids);
      db.run(`DELETE FROM explore_cards WHERE conversation_id IN (${placeholders}) OR branch_conversation_id IN (${placeholders})`, [...ids, ...ids]);
      db.run(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`, ids);
      db.run(`DELETE FROM conversations WHERE id IN (${placeholders})`, ids);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* noop */ }
      throw error;
    }
  });
  return ids;
}

export function listResources(db: Database, studentId: number, resourceType?: string): ResourceRow[] {
  const rows = resourceType
    ? db.all<Record<string, unknown>>("SELECT * FROM resources WHERE student_id = ? AND type = ? ORDER BY created_at DESC, id DESC", [studentId, resourceType])
    : db.all<Record<string, unknown>>("SELECT * FROM resources WHERE student_id = ? ORDER BY created_at DESC, id DESC", [studentId]);
  return rows.map(rowToResource);
}

export function getResource(db: Database, id: number): ResourceRow | undefined {
  const row = db.get<Record<string, unknown>>("SELECT * FROM resources WHERE id = ?", [id]);
  return row ? rowToResource(row) : undefined;
}

export function insertResource(db: Database, values: { studentId: number; conversationId?: number | null; type: string; title: string; content?: JsonObject; status?: string; meta?: JsonObject }): ResourceRow {
  const inserted = db.run("INSERT INTO resources (student_id, conversation_id, type, title, content, file_url, status, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [values.studentId, values.conversationId ?? null, values.type, values.title, json(values.content || {}), null, values.status || "completed", json(values.meta || {}), nowIso()]);
  return getResource(db, inserted.lastInsertRowid)!;
}

export function updateResource(db: Database, id: number, values: { content?: JsonObject; status?: string }): ResourceRow {
  const current = getResource(db, id);
  if (!current) throw new HttpError(404, "resource not found");
  db.run("UPDATE resources SET content = ?, status = ? WHERE id = ?", [json(values.content ?? current.content), values.status ?? current.status, id]);
  return getResource(db, id)!;
}

export function listCards(db: Database, studentId: number): ExploreCardRow[] {
  return db.all<Record<string, unknown>>("SELECT * FROM explore_cards WHERE student_id = ? ORDER BY created_at DESC, id DESC", [studentId]).map(rowToCard);
}

export function getCard(db: Database, id: number): ExploreCardRow | undefined {
  const row = db.get<Record<string, unknown>>("SELECT * FROM explore_cards WHERE id = ?", [id]);
  return row ? rowToCard(row) : undefined;
}

export function createCard(db: Database, values: { studentId: number; conversationId?: number | null; parentCardId?: number | null; sourceMessageId?: number | null; type: string; term: string; context?: string; branchConversationId?: number | null; status?: string }): ExploreCardRow {
  const inserted = db.run("INSERT INTO explore_cards (student_id, conversation_id, parent_card_id, source_message_id, type, term, context, branch_conversation_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [values.studentId, values.conversationId ?? null, values.parentCardId ?? null, values.sourceMessageId ?? null, values.type, values.term.slice(0, 128), (values.context || "").slice(0, 8000), values.branchConversationId ?? null, null, values.status || "processing", nowIso()]);
  return getCard(db, inserted.lastInsertRowid)!;
}

export function updateCard(db: Database, id: number, values: { type?: string; term?: string; context?: string; sourceMessageId?: number | null; branchConversationId?: number | null; content?: JsonObject | null; status?: string }): ExploreCardRow {
  const current = getCard(db, id);
  if (!current) throw new HttpError(404, "card not found");
  db.run("UPDATE explore_cards SET type = ?, term = ?, context = ?, source_message_id = ?, branch_conversation_id = ?, content = ?, status = ? WHERE id = ?", [values.type ?? current.type, (values.term ?? current.term).slice(0, 128), (values.context ?? current.context).slice(0, 8000), values.sourceMessageId === undefined ? current.source_message_id : values.sourceMessageId, values.branchConversationId === undefined ? current.branch_conversation_id : values.branchConversationId, values.content === undefined ? (current.content ? json(current.content) : null) : (values.content === null ? null : json(values.content)), values.status ?? current.status, id]);
  return getCard(db, id)!;
}

export function deleteCardTree(db: Database, cardId: number, studentId?: number): number[] {
  const card = getCard(db, cardId);
  if (!card) throw new HttpError(404, "card not found");
  if (studentId !== undefined && card.student_id !== studentId) throw new HttpError(403, "card does not belong to student");
  const all = listCards(db, card.student_id);
  const ids = [card.id];
  for (let index = 0; index < ids.length; index += 1) for (const item of all) if (item.parent_card_id === ids[index] && !ids.includes(item.id)) ids.push(item.id);
  const branchConversations = all.filter((item) => ids.includes(item.id) && item.branch_conversation_id).map((item) => item.branch_conversation_id as number);
  db.withoutForeignKeys(() => {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const conversationId of branchConversations) {
        const conversationIds = getConversation(db, conversationId) ? conversationTreeIds(db, getConversation(db, conversationId)!) : [];
        if (conversationIds.length) {
          const p = conversationIds.map(() => "?").join(",");
          db.run(`DELETE FROM messages WHERE conversation_id IN (${p})`, conversationIds);
          db.run(`DELETE FROM conversations WHERE id IN (${p})`, conversationIds);
        }
      }
      const placeholders = ids.map(() => "?").join(",");
      db.run(`DELETE FROM explore_cards WHERE id IN (${placeholders})`, ids);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* noop */ }
      throw error;
    }
  });
  return ids;
}

export function deleteMessage(db: Database, messageId: number, scope: "message" | "round"): number[] {
  const message = db.get<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [messageId]);
  if (!message) throw new HttpError(404, "message not found");
  const current = rowToMessage(message);
  const ids = [current.id];
  if (scope === "round" && current.role === "user") {
    const next = db.get<Record<string, unknown>>("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 1", [current.conversation_id, current.id]);
    if (next && text(next.role) === "assistant") ids.push(toNumber(next.id));
  }
  const sourceCards = db.all<Record<string, unknown>>(`SELECT * FROM explore_cards WHERE source_message_id IN (${ids.map(() => "?").join(",")})`, ids).map(rowToCard);
  const allCards = db.all<Record<string, unknown>>("SELECT * FROM explore_cards", []).map(rowToCard);
  const cardIds = sourceCards.map((item) => item.id);
  for (let index = 0; index < cardIds.length; index += 1) for (const item of allCards) if (item.parent_card_id === cardIds[index] && !cardIds.includes(item.id)) cardIds.push(item.id);
  db.withoutForeignKeys(() => {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (cardIds.length) db.run(`DELETE FROM explore_cards WHERE id IN (${cardIds.map(() => "?").join(",")})`, cardIds);
      db.run(`DELETE FROM messages WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* noop */ }
      throw error;
    }
  });
  return ids;
}

export function listLiteratures(db: Database, studentId: number): LiteratureRow[] {
  return db.all<Record<string, unknown>>("SELECT * FROM literatures WHERE student_id = ? ORDER BY created_at DESC, id DESC", [studentId]).map(rowToLiterature);
}

export function getLiterature(db: Database, id: number): LiteratureRow | undefined {
  const row = db.get<Record<string, unknown>>("SELECT * FROM literatures WHERE id = ?", [id]);
  return row ? rowToLiterature(row) : undefined;
}

export function insertLiterature(db: Database, values: { studentId: number; title: string; sourceType: string; text: string; terms?: Array<Record<string, string>>; meta?: JsonObject }): LiteratureRow {
  const inserted = db.run("INSERT INTO literatures (student_id, title, source_type, text, terms, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [values.studentId, values.title.slice(0, 256), values.sourceType, values.text, json(values.terms || []), json(values.meta || {}), nowIso()]);
  return getLiterature(db, inserted.lastInsertRowid)!;
}

export function updateLiteratureTerms(db: Database, id: number, terms: Array<Record<string, string>>): LiteratureRow {
  if (!getLiterature(db, id)) throw new HttpError(404, "literature not found");
  db.run("UPDATE literatures SET terms = ? WHERE id = ?", [json(terms), id]);
  return getLiterature(db, id)!;
}

export function listUnderstandings(db: Database, studentId: number): UnderstandingRow[] {
  return db.all<Record<string, unknown>>("SELECT * FROM understandings WHERE student_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC", [studentId]).map(rowToUnderstanding);
}

export function getUnderstanding(db: Database, id: number): UnderstandingRow | undefined {
  const row = db.get<Record<string, unknown>>("SELECT * FROM understandings WHERE id = ?", [id]);
  return row ? rowToUnderstanding(row) : undefined;
}

export function upsertUnderstanding(db: Database, values: { studentId: number; concept: string; summary: string; score: number; feedback: string; embedding: number[]; anchors: Array<Record<string, string>> }): UnderstandingRow {
  const rows = listUnderstandings(db, values.studentId);
  const target = values.embedding;
  let existing: UnderstandingRow | undefined;
  // The caller computes the related vectors; exact concept matching is a safe local fallback.
  existing = rows.find((row) => row.concept.trim().toLowerCase() === values.concept.trim().toLowerCase());
  if (existing) {
    db.run("UPDATE understandings SET summary = ?, ai_score = ?, ai_feedback = ?, embedding = ?, anchors = ?, status = 'approved' WHERE id = ?", [values.summary, values.score, values.feedback, json(target), json(values.anchors), existing.id]);
    return getUnderstanding(db, existing.id)!;
  }
  const inserted = db.run("INSERT INTO understandings (student_id, concept, summary, ai_score, ai_feedback, status, embedding, anchors, source, created_at) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)", [values.studentId, values.concept.slice(0, 128), values.summary, values.score, values.feedback, json(target), json(values.anchors), json({}), nowIso()]);
  return getUnderstanding(db, inserted.lastInsertRowid)!;
}

export function listPractice(db: Database, studentId: number, filter: "all" | "wrong" | "right" | "pending" = "all"): PracticeRecordRow[] {
  let sql = "SELECT * FROM practice_records WHERE student_id = ?";
  const params: unknown[] = [studentId];
  if (filter === "pending") sql += " AND is_correct IS NULL";
  if (filter === "wrong") { sql += " AND is_correct = 0"; }
  if (filter === "right") { sql += " AND is_correct = 1"; }
  sql += " ORDER BY id DESC";
  return db.all<Record<string, unknown>>(sql, params).map(rowToPractice);
}

export function insertPractice(db: Database, values: { studentId: number; conversationId: number; topic: string; question: string; options: string[]; answer: string; explanation: string; isCorrect?: boolean | null }): PracticeRecordRow {
  const inserted = db.run("INSERT INTO practice_records (student_id, conversation_id, topic, question, options, answer, explanation, is_correct, asked_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [values.studentId, values.conversationId, values.topic.slice(0, 128), values.question, json(values.options), values.answer, values.explanation, boolToSql(values.isCorrect), nowIso(), null]);
  return rowToPractice(db.get<Record<string, unknown>>("SELECT * FROM practice_records WHERE id = ?", [inserted.lastInsertRowid])!);
}

export function markLastPractice(db: Database, conversationId: number, correct: boolean, question?: string): void {
  let sql = "SELECT * FROM practice_records WHERE conversation_id = ? AND is_correct IS NULL";
  const params: unknown[] = [conversationId];
  if (question) { sql += " AND question = ?"; params.push(question.slice(0, 4000)); }
  sql += " ORDER BY id DESC LIMIT 1";
  const row = db.get<Record<string, unknown>>(sql, params);
  if (row) db.run("UPDATE practice_records SET is_correct = ?, answered_at = ? WHERE id = ?", [correct ? 1 : 0, nowIso(), toNumber(row.id)]);
}

export function activeQuizSession(db: Database, conversationId: number): JsonObject | undefined {
  const row = db.get<Record<string, unknown>>("SELECT meta FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1", [conversationId]);
  const meta = parseJson<JsonObject>(row?.meta, {});
  const session = meta.quiz_session;
  return session && typeof session === "object" && (session as JsonObject).active ? session as JsonObject : undefined;
}
