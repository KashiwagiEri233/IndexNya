import type { Database } from "./db.ts";
import { json } from "./db.ts";
import { HttpError } from "./errors.ts";
import { chatStream, hasUsableModel } from "./llm.ts";
import { extractTerms } from "./agents.ts";
import { getAnchorContext } from "./universe.ts";
import { branchConversation, createCard, createConversation, getCard, getConversation, insertMessage, listCards, listMessages, listUnderstandings, updateCard, deleteCardTree } from "./repository.ts";
import type { ChatMessage, ExploreRequest, JsonObject, SseEvent } from "./types.ts";

const PROMPTS: Record<string, string> = {
  child: `你是一位背景知识深挖讲解智能体。学生点击了术语「{term}」，请先给出定义，再解释它为什么存在、解决什么问题、依赖哪些前置知识；配例子、图示和易错点，结尾给出延伸思考。用中文 Markdown。`,
  related: `你是一位概念发散对比智能体。围绕「{term}」找出 3-5 个相关概念，给出 Markdown 对比表（概念、核心区别、联系、适用场景），并给出继续发散的关键词。用中文 Markdown。`,
  branch: `你是一条分支对话中的讲解智能体。聚焦术语「{term}」，系统讲解背景、原理、例子和易错点，结尾给出延伸思考。用中文 Markdown。`,
};

function event(name: string, data: unknown): SseEvent { return { event: name, data }; }

function fallback(term: string, mode: string): string {
  if (mode === "related") return `## 「${term}」的关联概念\n\n| 概念 | 核心区别 | 适用场景 |\n| --- | --- | --- |\n| 基础定义 | 说明概念本身 | 入门理解 |\n| 相近方法 | 关注不同约束 | 对比选择 |\n\n建议继续检索：${term} 的原理、例子与常见误区。`;
  return `## 「${term}」\n\n「${term}」可以先从定义、解决的问题和一个最小例子三个角度理解。\n\n### 学习路径\n1. 补齐前置知识。\n2. 用例子验证核心机制。\n3. 对比相近概念并记录易错点。`;
}

function promptFor(mode: string, term: string): string { return (PROMPTS[mode] || PROMPTS.child).replaceAll("{term}", term); }

export async function* streamExplore(db: Database, payload: ExploreRequest): AsyncGenerator<SseEvent> {
  const studentId = payload.student_id!;
  const mode = ["child", "related", "branch"].includes(payload.mode || "") ? payload.mode! : "child";
  const term = payload.term.trim().slice(0, 120);
  let card = payload.card_id ? getCard(db, payload.card_id) : undefined;
  let branch: ReturnType<typeof getConversation>;
  try {
    if (mode === "branch") {
      const sourceId = payload.conversation_id || card?.conversation_id;
      if (!sourceId) { yield event("error", { message: "分支卡片需要来源对话（conversation_id）" }); return; }
      const source = getConversation(db, sourceId);
      if (!source || source.student_id !== studentId) { yield event("error", { message: "来源对话不存在" }); return; }
      branch = card?.branch_conversation_id ? getConversation(db, card.branch_conversation_id) : undefined;
      if (!branch) branch = branchConversation(db, source.id, `围绕「${term}」的分支`, studentId);
      if (!card) card = createCard(db, { studentId, conversationId: source.id, parentCardId: payload.parent_card_id ?? null, sourceMessageId: payload.source_message_id ?? null, type: "branch", term, context: payload.context || "", branchConversationId: branch.id, status: "processing" });
      else card = updateCard(db, card.id, { type: "branch", term, context: payload.context || "", sourceMessageId: payload.source_message_id ?? card.source_message_id, branchConversationId: branch.id, status: "processing" });
      const seed = payload.seed_message?.trim() || `请结合上文，完整讲解「${term}」。`;
      insertMessage(db, { conversationId: branch.id, role: "user", content: seed });
    }
    if (!card) card = createCard(db, { studentId, conversationId: payload.conversation_id ?? null, parentCardId: payload.parent_card_id ?? null, sourceMessageId: payload.source_message_id ?? null, type: mode, term, context: payload.context || "", status: "processing" });
    else card = updateCard(db, card.id, { type: mode, term, context: payload.context || "", sourceMessageId: payload.source_message_id ?? card.source_message_id, status: "processing" });

    yield event("meta", { card_id: card.id, mode, conversation_id: payload.conversation_id ?? null, branch_conversation_id: branch?.id ?? card.branch_conversation_id ?? null, source_message_id: payload.source_message_id ?? card.source_message_id ?? null });
    const anchors = getAnchorContext(listUnderstandings(db, studentId), term);
    const context = [payload.explanation ? `已有简要解释：${payload.explanation.slice(0, 300)}` : "", payload.context ? `来源上下文（学生点击的位置）：\n${payload.context.slice(0, 8000)}` : "", anchors].filter(Boolean).join("\n\n");
    const userContent = payload.seed_message?.trim() || `请围绕术语「${term}」展开。`;
    const messages: ChatMessage[] = [{ role: "system", content: promptFor(mode, term) }, ...(context ? [{ role: "system", content: context }] : []), { role: "user", content: userContent }];
    let fullText = "";
    if (hasUsableModel(payload.model)) {
      for await (const chunk of chatStream(payload.model, messages, { temperature: 0.6, maxTokens: 4096 })) if (chunk.type === "token") { fullText += chunk.text; yield event("token", { text: chunk.text }); }
    }
    if (!fullText) { fullText = fallback(term, mode); yield event("token", { text: fullText }); }
    const terms = extractTerms(fullText);
    if (terms.length) yield event("terms", { terms });
    if (mode === "branch" && branch) insertMessage(db, { conversationId: branch.id, role: "assistant", content: fullText, meta: { mode: "explore", term, terms } });
    card = updateCard(db, card.id, { content: { question: userContent, messages: [{ role: "user", content: userContent }, { role: "assistant", content: fullText, terms }] }, status: "completed" });
    yield event("done", { card_id: card.id });
  } catch (error) {
    if (card) { try { updateCard(db, card.id, { status: "failed" }); } catch { /* noop */ } }
    yield event("error", { message: `探索卡片生成失败：${error instanceof Error ? error.message : String(error)}` });
  }
}

export function removeCard(db: Database, id: number, studentId: number): number[] { return deleteCardTree(db, id, studentId); }
