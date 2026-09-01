import type { Database } from "./db.ts";
import { parseJson } from "./db.ts";
import { HttpError } from "./errors.ts";
import { streamChat } from "./chat.ts";
import { streamExplore } from "./hierarchy.ts";
import { extractText, extractLiteratureTerms, LITERATURE_MAX_SIZE } from "./literature.ts";
import { understandImage, IMAGE_MAX_SIZE, IMAGE_TYPES } from "./image.ts";
import { testModel } from "./llm.ts";
import { deleteSkill, getSkill, installSkillFromZip, listSkills, setSkillEnabled } from "./skills.ts";
import { buildGraph, createUnderstandingValues, evaluateSummary, getAnchorContext, relatedUnderstandings } from "./universe.ts";
import {
  branchConversation,
  createCard,
  createConversation,
  deleteCardTree,
  deleteConversationTree,
  deleteMessage,
  getCard,
  getConversation,
  getLiterature,
  getResource,
  getUnderstanding,
  getLocalStudent,
  insertLiterature,
  insertResource,
  listCards,
  listConversations,
  listLiteratures,
  listMessages,
  listPractice,
  listResources,
  listUnderstandings,
  rowToPractice,
  updateLiteratureTerms,
  updateResource,
} from "./repository.ts";
import { exportData, exportNotes, importData } from "./data.ts";
import type { ChatRequest, ExploreRequest, JsonObject, ModelConfig } from "./types.ts";

export interface ApiRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: Headers;
  body: Buffer;
}

export interface ApiResponse {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  stream?: AsyncIterable<{ event: string; data: unknown }>;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function ok(jsonValue: unknown, status = 200): ApiResponse { return { status, headers: JSON_HEADERS, json: jsonValue }; }
function textResponse(value: string, status = 200, contentType = "text/plain; charset=utf-8"): ApiResponse { return { status, headers: { "Content-Type": contentType }, text: value }; }
function methodNotAllowed(): never { throw new HttpError(405, "method not allowed"); }
function parseId(value: string | undefined, label = "id"): number { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${label} 必须是正整数`); return id; }
function parseJsonBody<T = Record<string, unknown>>(request: ApiRequest): T { if (!request.body.length) return {} as T; try { return JSON.parse(request.body.toString("utf8")) as T; } catch { throw new HttpError(400, "请求体不是有效的 JSON"); } }
function modelFrom(value: unknown): ModelConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (!input.model) return undefined;
  return { id: input.id ? String(input.id) : undefined, name: input.name ? String(input.name) : undefined, type: input.type ? String(input.type) : undefined, model: String(input.model), base_url: input.base_url ? String(input.base_url) : undefined, api_key: input.api_key ? String(input.api_key) : undefined, reasoning_effort: input.reasoning_effort ? String(input.reasoning_effort) : undefined };
}

async function formData(request: ApiRequest): Promise<FormData> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new HttpError(400, "需要 multipart/form-data 请求");
  const parsed = new Request(`http://indexnya.local${request.pathname}`, { method: request.method, headers: request.headers, body: request.body as unknown as BodyInit }).formData();
  return parsed;
}

function serializeConversation(value: ReturnType<typeof getConversation>): JsonObject | null { return value ? { id: value.id, student_id: value.student_id, title: value.title, parent_conversation_id: value.parent_conversation_id, created_at: value.created_at } : null; }
function serializeResource(value: ReturnType<typeof getResource>): JsonObject | null { return value ? { id: value.id, student_id: value.student_id, conversation_id: value.conversation_id, type: value.type, title: value.title, content: value.content, file_url: value.file_url, status: value.status, created_at: value.created_at } : null; }
function serializeLiterature(value: ReturnType<typeof getLiterature>, includeText = false): JsonObject | null {
  if (!value) return null;
  const result: JsonObject = { id: value.id, student_id: value.student_id, title: value.title, source_type: value.source_type, terms: value.terms, created_at: value.created_at };
  if (includeText) result.text = value.text;
  return result;
}

export async function handleApiRequest(request: ApiRequest, db: Database): Promise<ApiResponse> {
  const pathname = request.pathname.replace(/^\/api\/?/, "");
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const method = request.method.toUpperCase();
  const student = getLocalStudent(db);

  if (method === "OPTIONS") return { status: 204, headers: {} };
  if (!parts.length && method === "GET") return ok({ status: "ok", app_name: "Index 学习岛" });
  if (parts[0] === "health" && method === "GET") return ok({ status: "ok", app_name: "Index 学习岛" });

  // Conversations and messages ------------------------------------------------
  if (parts[0] === "conversations") {
    if (parts.length === 1 && method === "GET") return ok(listConversations(db, student.id));
    if (parts.length === 2) {
      const id = parseId(parts[1], "conversation_id");
      if (method === "DELETE") return ok({ deleted_ids: deleteConversationTree(db, id, student.id) });
    }
    if (parts.length === 3 && parts[2] === "messages" && method === "GET") return ok(listMessages(db, parseId(parts[1], "conversation_id")));
    if (parts.length === 3 && parts[2] === "branch" && method === "POST") {
      const sourceId = parseId(parts[1], "conversation_id");
      const payload = parseJsonBody<{ title?: string }>(request);
      const branch = branchConversation(db, sourceId, payload.title, student.id);
      return ok({ ...serializeConversation(branch), branched_from: sourceId });
    }
  }
  if (parts[0] === "messages" && parts.length === 2) {
    const id = parseId(parts[1], "message_id");
    if (method === "PUT") {
      const payload = parseJsonBody<{ content?: string }>(request);
      const content = String(payload.content || "").trim();
      if (!content || content.length > 20_000) throw new HttpError(400, "消息内容不能为空且不能超过 20000 字符");
      const row = db.get<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [id]);
      if (!row) throw new HttpError(404, "message not found");
      if (String(row.role) !== "user") throw new HttpError(400, "只能编辑自己的提问消息");
      const meta = parseJson<JsonObject>(row.meta, {}); meta.edited = true; meta.edited_at = new Date().toISOString();
      db.run("UPDATE messages SET content = ?, meta = ? WHERE id = ?", [content, JSON.stringify(meta), id]);
      const updated = db.get<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [id]);
      return ok(updated);
    }
    if (method === "DELETE") {
      const scope = request.searchParams.get("scope") === "message" ? "message" : "round";
      return ok({ deleted_ids: deleteMessage(db, id, scope) });
    }
  }

  // Model and chat ------------------------------------------------------------
  if (parts[0] === "models" && parts[1] === "test" && method === "POST") {
    const payload = parseJsonBody<Record<string, unknown>>(request);
    const model = modelFrom(payload);
    if (!model) throw new HttpError(400, "模型配置不能为空");
    return ok(await testModel(model));
  }
  if (parts[0] === "chat" && parts.length === 1 && method === "POST") {
    const payload = parseJsonBody<ChatRequest>(request);
    if (!payload.message?.trim()) throw new HttpError(400, "message is required");
    payload.model = modelFrom(payload.model);
    return { stream: streamChat(db, { ...payload, message: payload.message.trim() }) };
  }

  // Resources and tutoring ----------------------------------------------------
  if (parts[0] === "resources") {
    if (parts.length === 1 && method === "GET") return ok(listResources(db, student.id, request.searchParams.get("type") || undefined).map((item) => serializeResource(item)));
    if (parts.length === 2 && parts[1] === "generate" && method === "POST") {
      const payload = parseJsonBody<{ type?: string; topic?: string; conversation_id?: number; extra?: JsonObject; model?: ModelConfig }>(request);
      const type = String(payload.type || ""); const topic = String(payload.topic || "").trim();
      if (!["lecture", "mindmap", "reading", "code"].includes(type)) throw new HttpError(400, `unknown resource type: ${type}`);
      if (!topic) throw new HttpError(400, "topic is required");
      const label = ({ lecture: "讲解文档", mindmap: "思维导图", reading: "拓展阅读", code: "代码实操" } as Record<string, string>)[type];
      const resource = insertResource(db, { studentId: student.id, conversationId: payload.conversation_id ?? null, type, title: `${label}：${topic}`, status: "processing" });
      try {
        const history = payload.conversation_id ? listMessages(db, Number(payload.conversation_id)).map((item) => ({ role: item.role, content: item.content })) : [];
        const anchors = getAnchorText(db, student.id, topic);
        const { generateResourceContent } = await import("./agents.ts");
        const content = await generateResourceContent(type, topic, history, modelFrom(payload.model), payload.extra || {}, anchors);
        return ok(serializeResource(updateResource(db, resource.id, { content, status: "completed" })));
      } catch (error) {
        return ok(serializeResource(updateResource(db, resource.id, { content: { error: error instanceof Error ? error.message : String(error) }, status: "failed" })));
      }
    }
    if (parts.length === 2) {
      const id = parseId(parts[1], "resource_id");
      if (method === "GET") { const value = getResource(db, id); if (!value) throw new HttpError(404, "resource not found"); return ok(serializeResource(value)); }
      if (method === "DELETE") { if (!getResource(db, id)) throw new HttpError(404, "resource not found"); db.run("DELETE FROM resources WHERE id = ?", [id]); return ok({ deleted_id: id }); }
    }
  }
  if (parts[0] === "tutor" && parts[1] === "ask" && method === "POST") {
    const payload = parseJsonBody<{ question?: string; context_resource_id?: number; modality?: string; model?: ModelConfig }>(request);
    const question = String(payload.question || "").trim(); if (!question) throw new HttpError(400, "question is required");
    let context = "";
    if (payload.context_resource_id) { const resource = getResource(db, Number(payload.context_resource_id)); if (resource) context = `${resource.title}（${resource.type}）：${JSON.stringify(resource.content).slice(0, 500)}`; }
    const { tutorAnswer } = await import("./agents.ts");
    return ok(await tutorAnswer(question, context, payload.modality || "text", modelFrom(payload.model)));
  }

  // Practice notebook ---------------------------------------------------------
  if (parts[0] === "practice") {
    if (parts.length === 1 && method === "GET") {
      const filter = (request.searchParams.get("filter") || "all") as "all" | "wrong" | "right" | "pending";
      if (!["all", "wrong", "right", "pending"].includes(filter)) throw new HttpError(400, "filter 参数无效");
      return ok(listPractice(db, student.id, filter));
    }
    if (parts.length === 1 && method === "DELETE") { const result = db.run("DELETE FROM practice_records WHERE student_id = ?", [student.id]); return ok({ deleted_count: result.changes }); }
    if (parts.length === 2 && method === "DELETE") { const id = parseId(parts[1], "record_id"); if (!db.get("SELECT id FROM practice_records WHERE id = ? AND student_id = ?", [id, student.id])) throw new HttpError(404, "practice record not found"); db.run("DELETE FROM practice_records WHERE id = ?", [id]); return ok({ deleted_id: id }); }
  }

  // Skills --------------------------------------------------------------------
  if (parts[0] === "skills") {
    if (parts.length === 1 && method === "GET") return ok(listSkills().map(({ content: _content, ...item }) => item));
    if (parts.length === 1 && method === "POST") {
      const data = await formData(request); const file = data.get("file") as any; if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "请上传 .zip 技能包");
      const name = String(file.name || "skill.zip"); if (!name.toLowerCase().endsWith(".zip")) throw new HttpError(400, "仅支持 .zip 技能包");
      const buffer = Buffer.from(await file.arrayBuffer()); const names = await installSkillFromZip(buffer, name); return ok({ names, message: `已安装技能：${names.join(", ")}` });
    }
    if (parts.length === 2) {
      const name = parts[1];
      if (method === "GET") { const skill = getSkill(name); if (!skill) throw new HttpError(404, `skill not found: ${name}`); return ok(skill); }
      if (method === "DELETE") { if (!deleteSkill(name)) throw new HttpError(404, `skill not found: ${name}`); return ok({ name, status: "deleted" }); }
    }
    if (parts.length === 3 && parts[2] === "enabled" && method === "PUT") {
      const payload = parseJsonBody<{ enabled?: boolean }>(request); if (!setSkillEnabled(parts[1], Boolean(payload.enabled))) throw new HttpError(404, `skill not found: ${parts[1]}`); return ok({ name: parts[1], enabled: Boolean(payload.enabled) });
    }
  }

  // Image understanding -------------------------------------------------------
  if (parts[0] === "image" && parts[1] === "understand" && method === "POST") {
    const data = await formData(request); const file = data.get("image") as any; if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "请上传图片");
    const contentType = String(file.type || ""); if (!IMAGE_TYPES.has(contentType)) throw new HttpError(400, `unsupported image type: ${contentType}（仅支持 jpg/png）`);
    const image = Buffer.from(await file.arrayBuffer()); if (image.length > IMAGE_MAX_SIZE) throw new HttpError(400, `image too large: ${image.length} bytes (max 4MB)`);
    const question = String(data.get("question") || "请描述这张图片并解释相关知识点");
    let model: ModelConfig | undefined; const rawModel = data.get("model"); if (rawModel) { try { model = modelFrom(JSON.parse(String(rawModel))); } catch { /* optional */ } }
    return ok(await understandImage(image, question, contentType, model));
  }

  // Hierarchy cards -----------------------------------------------------------
  if (parts[0] === "hierarchy") {
    if (parts.length === 2 && parts[1] === "cards" && method === "GET") return ok(listCards(db, student.id));
    if (parts.length === 3 && parts[1] === "cards" && method === "DELETE") return ok({ deleted_ids: deleteCardTree(db, parseId(parts[2], "card_id"), student.id) });
    if (parts.length === 2 && parts[1] === "explore" && method === "POST") {
      const payload = parseJsonBody<ExploreRequest>(request); if (!payload.term?.trim()) throw new HttpError(400, "term is required"); payload.student_id = student.id; payload.model = modelFrom(payload.model);
      return { stream: streamExplore(db, payload) };
    }
  }

  // Literature -----------------------------------------------------------------
  if (parts[0] === "literature") {
    if (parts.length === 1 && method === "GET") return ok(listLiteratures(db, student.id).map((item) => serializeLiterature(item)));
    if (parts.length === 2 && parts[1] === "upload" && method === "POST") {
      const data = await formData(request); const file = data.get("file") as any; if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "请上传文献文件");
      const raw = Buffer.from(await file.arrayBuffer()); if (raw.length > LITERATURE_MAX_SIZE) throw new HttpError(400, `文件过大（${Math.floor(raw.length / 1024 / 1024)}MB），上限 10MB`);
      const extracted = extractText(String(file.name || ""), raw); const text = extracted.text.trim(); if (text.length < 20) throw new HttpError(400, "未从文件中提取到文本（扫描版 PDF 不支持），请改用 TXT/Markdown 或直接粘贴");
      const title = String(file.name || "未命名").replace(/\.[^.]+$/, "").slice(0, 120); return ok(serializeLiterature(insertLiterature(db, { studentId: student.id, title, sourceType: extracted.sourceType, text: text.slice(0, 200_000), terms: [], meta: { chars: text.length } })));
    }
    if (parts.length === 3 && parts[2] === "terms" && method === "POST") {
      const id = parseId(parts[1], "literature_id"); const literature = getLiterature(db, id); if (!literature) throw new HttpError(404, "literature not found");
      const payload = parseJsonBody<{ model?: ModelConfig }>(request); const terms = await extractLiteratureTerms(literature.text, modelFrom(payload.model)); return ok(serializeLiterature(updateLiteratureTerms(db, id, terms)));
    }
    if (parts.length === 2) {
      const id = parseId(parts[1], "literature_id");
      if (method === "GET") { const value = getLiterature(db, id); if (!value) throw new HttpError(404, "literature not found"); return ok(serializeLiterature(value, true)); }
      if (method === "DELETE") { if (!getLiterature(db, id)) throw new HttpError(404, "literature not found"); db.run("DELETE FROM literatures WHERE id = ?", [id]); return ok({ id, status: "deleted" }); }
    }
  }

  // Thought universe ----------------------------------------------------------
  if (parts[0] === "universe") {
    if (parts.length === 1 && method === "GET") return ok(listUnderstandings(db, student.id));
    if (parts.length === 2 && parts[1] === "graph" && method === "GET") return ok(buildGraph(listUnderstandings(db, student.id)));
    if (parts.length === 2 && parts[1] === "anchors" && method === "GET") { const topic = request.searchParams.get("topic") || ""; return ok({ topic, anchors: relatedAnchorRows(db, student.id, topic) }); }
    if (parts.length === 1 && method === "POST") {
      const payload = parseJsonBody<{ concept?: string; summary?: string; model?: ModelConfig }>(request); const concept = String(payload.concept || "").trim(); const summary = String(payload.summary || "").trim(); if (!concept || !summary) throw new HttpError(400, "概念与理解内容不能为空");
      const verdict = await evaluateSummary(concept, summary, modelFrom(payload.model));
      if (!verdict.approved) return ok({ ...verdict, understanding: null });
      const values = createUnderstandingValues(listUnderstandings(db, student.id), concept, summary, verdict);
      let id = values.existingId;
      if (id) db.run("UPDATE understandings SET summary = ?, ai_score = ?, ai_feedback = ?, embedding = ?, anchors = ? WHERE id = ?", [summary, verdict.score, verdict.feedback, JSON.stringify(values.embedding), JSON.stringify(values.anchors), id]);
      else { const inserted = db.run("INSERT INTO understandings (student_id, concept, summary, ai_score, ai_feedback, status, embedding, anchors, source, created_at) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, '{}', ?)", [student.id, concept.slice(0, 128), summary, verdict.score, verdict.feedback, JSON.stringify(values.embedding), JSON.stringify(values.anchors), new Date().toISOString()]); id = inserted.lastInsertRowid; }
      return ok({ ...verdict, understanding: getUnderstanding(db, id) });
    }
    if (parts.length === 2 && method === "DELETE") { const id = parseId(parts[1], "understanding_id"); if (!getUnderstanding(db, id)) throw new HttpError(404, "understanding not found"); db.run("DELETE FROM understandings WHERE id = ?", [id]); return ok({ id, status: "deleted" }); }
  }

  // Backup / restore / notes --------------------------------------------------
  if (parts[0] === "data") {
    if (parts.length === 2 && parts[1] === "export" && method === "GET") return ok(exportData(db, student.id));
    if (parts.length === 2 && parts[1] === "import" && method === "POST") {
      const data = await formData(request); const file = data.get("file") as any; if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "请上传 JSON 文件");
      const raw = Buffer.from(await file.arrayBuffer()); if (raw.length > 50 * 1024 * 1024) throw new HttpError(400, "文件过大，上限 50MB");
      let parsed: unknown; try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "文件不是有效的 JSON"); }
      const mode = String(data.get("mode") || "merge") === "restore" ? "restore" : "merge"; return ok(importData(db, student.id, parsed, mode));
    }
    if (parts.length === 2 && parts[1] === "export-notes" && method === "POST") {
      const payload = parseJsonBody<{ conversation_ids?: number[]; format?: "both" | "notes" | "mindmap"; mode?: "direct" | "ai"; model?: ModelConfig }>(request);
      return ok(await exportNotes(db, (payload.conversation_ids || []).map(Number), payload.format || "both", payload.mode || "direct", modelFrom(payload.model)));
    }
  }

  methodNotAllowed();
}

function getAnchorText(db: Database, studentId: number, topic: string): string {
  return getAnchorContext(listUnderstandings(db, studentId), topic);
}
function relatedAnchorRows(db: Database, studentId: number, topic: string): JsonObject[] {
  return relatedUnderstandings(listUnderstandings(db, studentId), topic, 5).map(({ row, similarity }) => ({ id: row.id, concept: row.concept, summary: row.summary, score: row.ai_score, similarity: Number(similarity.toFixed(3)) }));
}
