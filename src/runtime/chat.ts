import type { Database } from "./db.ts";
import { json, parseJson } from "./db.ts";
import { HttpError } from "./errors.ts";
import { chatComplete, chatCompleteText, chatStream, hasUsableModel } from "./llm.ts";
import {
  buildSkillsPrompt,
  conversationMessages,
  extractTerms,
  findUseSkillCall,
  formatResourcePreview,
  generateResourceContent,
  keywordRoute,
  routeLight,
  skillByName,
  templatePlan,
  tutorAnswer,
  useSkillTool,
} from "./agents.ts";
import { getAnchorContext } from "./universe.ts";
import {
  applyToolArgs,
  closeSession,
  fallbackQuestion,
  findAskQuestion,
  gradeAnswer,
  isQuizExit,
  isQuizSession,
  newSession,
  parseAskQuestionArgs,
  serializeSession,
  summaryText,
  tryExtractQuestionFromText,
  QUIZ_SYSTEM_PROMPT,
  QUIZ_TOOL,
  type QuizSession,
} from "./quiz.ts";
import { activeQuizSession, getLocalStudent, getConversation, createConversation, insertMessage, listMessages, listUnderstandings, insertPractice, markLastPractice, getResource, insertResource, updateResource } from "./repository.ts";
import type { ChatMessage, ChatRequest, JsonObject, SseEvent, ToolCall } from "./types.ts";
import type { RouteDecision } from "./agents.ts";

function event(event: string, data: unknown): SseEvent { return { event, data }; }

function modelPayload(payload: ChatRequest) { return payload.model; }

function fallbackChat(message: string): string {
  return `我先把「${message.slice(0, 80)}」拆成一个可执行的学习问题：\n\n1. 先明确它的定义和要解决的问题；\n2. 再用一个最小例子验证核心机制；\n3. 最后对比相近概念，整理易错点。\n\n你可以在左下角「设置」中配置一个 OpenAI 兼容模型，我就能继续给出更具体的讲解。`;
}

function validResourceType(value: unknown): value is "lecture" | "mindmap" | "reading" | "code" {
  return ["lecture", "mindmap", "reading", "code"].includes(String(value));
}

async function normalizeRoute(payload: ChatRequest, activeQuiz: JsonObject | undefined, history: ChatMessage[]): Promise<RouteDecision> {
  return (async () => {
    if (activeQuiz || payload.mode === "quiz_session") return { action: "quiz_session" as const, topic: payload.message };
    if (payload.resource_type) {
      if (payload.resource_type === "video") return { action: "tutor" as const, topic: payload.message, video_topic: payload.message };
      if (payload.resource_type === "quiz") return { action: "quiz_session" as const, topic: payload.message };
      if (validResourceType(payload.resource_type)) return { action: "resource" as const, resource_type: payload.resource_type, topic: payload.message };
    }
    const quick = keywordRoute(payload.message);
    return quick || await routeLight(payload.message, history, payload.model);
  })();
}

function parseQuizState(value: unknown): QuizSession | undefined {
  if (!isQuizSession(value)) return undefined;
  const raw = value as unknown as JsonObject;
  return {
    active: Boolean(raw.active), topic: String(raw.topic || ""), index: Number(raw.index || 0), score: Number(raw.score || 0), total: Number(raw.total || 5),
    items: Array.isArray(raw.items) ? raw.items.map((item) => {
      const row = (item || {}) as JsonObject;
      return { question: String(row.question || ""), options: Array.isArray(row.options) ? row.options.map(String) : [], answer: String(row.answer || ""), explanation: String(row.explanation || ""), correct: typeof row.correct === "boolean" ? row.correct : null };
    }) : [],
  };
}

function recordQuizQuestion(db: Database, studentId: number, conversationId: number, session: QuizSession, args: Record<string, unknown>): void {
  try {
    insertPractice(db, {
      studentId, conversationId, topic: session.topic, question: String(args.question || "").slice(0, 4000),
      options: Array.isArray(args.options) ? args.options.map(String) : [], answer: String(args.answer || "").slice(0, 2000), explanation: String(args.explanation || "").slice(0, 2000), isCorrect: null,
    });
  } catch {
    // A practice record is supplementary; never break the chat response.
  }
}

async function quizTurn(db: Database, studentId: number, conversationId: number, payload: ChatRequest, history: ChatMessage[], routeTopic: string): Promise<{ text: string; session: QuizSession; quizEvent: JsonObject; keptActive?: boolean }> {
  const active = parseQuizState(activeQuizSession(db, conversationId));
  const session = active || newSession(routeTopic || payload.message);
  const exiting = Boolean(active && isQuizExit(payload.message));
  let localGrade: boolean | null = null;
  const lastItem = active?.items.at(-1);
  if (active && !exiting && lastItem) {
    localGrade = gradeAnswer(payload.message, lastItem);
    if (localGrade !== null) markLastPractice(db, conversationId, localGrade, lastItem.question);
  }
  const complete = session.index >= session.total;

  if (exiting || complete) {
    if (localGrade !== null && lastItem) {
      lastItem.correct = localGrade;
      session.score += localGrade ? 1 : 0;
    }
    closeSession(session);
    let text = "";
    if (hasUsableModel(payload.model)) {
      try {
        const content = await chatCompleteText(payload.model, [{ role: "system", content: QUIZ_SYSTEM_PROMPT }, ...history.slice(-8), { role: "user", content: `请总结本轮「${session.topic}」练习，已答 ${session.index} 题，答对 ${session.score} 题。不要再出题。` }], { temperature: 0.5, maxTokens: 2048 });
        text = content.trim();
      } catch { /* local summary below */ }
    }
    if (!text) text = summaryText(session);
    return { text, session: serializeSession(session), quizEvent: { action: "summary", session: serializeSession(session) } };
  }

  const messages: ChatMessage[] = [{ role: "system", content: QUIZ_SYSTEM_PROMPT }, ...history.slice(-8).map((item) => ({ role: item.role, content: String(item.content).slice(0, 1500) }))];
  let userContent = payload.message;
  if (localGrade !== null) userContent = `【系统判定：学生上一题作答${localGrade ? "正确" : "错误"}，请以该判定为准填写 previous_correct 并在点评中保持一致】\n\n${payload.message}`;
  messages.push({ role: "user", content: userContent });

  let content = "";
  let args: Record<string, unknown> | undefined;
  if (hasUsableModel(payload.model)) {
    try {
      let response;
      try {
        response = await chatComplete(payload.model, messages, { temperature: 0.5, maxTokens: 4096, tools: [QUIZ_TOOL], toolChoice: "required" });
      } catch {
        response = await chatComplete(payload.model, messages, { temperature: 0.5, maxTokens: 4096, tools: [QUIZ_TOOL] });
      }
      content = response.content.trim();
      args = findAskQuestion(response.toolCalls);
      if (!args) args = tryExtractQuestionFromText(content);
      if (!args) {
        const continuation = await chatComplete(payload.model, [...messages, { role: "user", content: `【系统提示】练习尚未完成（已完成 ${session.index}/${session.total} 题）。请继续通过 ask_question 工具出下一题，暂时不要总结。` }], { temperature: 0.5, maxTokens: 4096, tools: [QUIZ_TOOL], toolChoice: "required" });
        if (!content) content = continuation.content.trim();
        args = findAskQuestion(continuation.toolCalls) || tryExtractQuestionFromText(continuation.content);
      }
    } catch {
      // Use a deterministic question when the provider does not support tools.
    }
  }
  if (!args) args = fallbackQuestion(session.topic || routeTopic || payload.message, session.index);
  if (localGrade !== null) args.previous_correct = localGrade;
  if (!String(args.question || "").trim()) args.question = `请说明「${session.topic || payload.message}」的核心原理。`;
  if (!Array.isArray(args.options)) args.options = [];
  if (!String(args.answer || "").trim()) args.answer = "请围绕定义、原理和例子作答";
  if (!String(args.explanation || "").trim()) args.explanation = "可以从定义、解决的问题和具体例子三个角度检查答案。";
  applyToolArgs(session, args);
  recordQuizQuestion(db, studentId, conversationId, session, args);
  const question = String(args.question);
  if (!content || !content.includes(question)) content = `${content ? `${content}\n\n` : ""}请作答下面这道题：\n\n${question}`;
  return { text: content, session: serializeSession(session), quizEvent: { action: "question", question, options: args.options, index: session.index, score: session.score, session: serializeSession(session) } };
}

export async function* streamChat(db: Database, payload: ChatRequest): AsyncGenerator<SseEvent> {
  const student = getLocalStudent(db);
  let conversation = payload.conversation_id ? getConversation(db, payload.conversation_id) : undefined;
  if (conversation && conversation.student_id !== student.id) throw new HttpError(403, "conversation does not belong to student");
  if (!conversation) conversation = createConversation(db, student.id, payload.message || "新对话");
  const userMessage = insertMessage(db, { conversationId: conversation.id, role: "user", content: payload.message });
  yield event("meta", { conversation_id: conversation.id, student_id: student.id, mode: payload.mode || "chat", resource_type: payload.resource_type || null });

  const allMessages = listMessages(db, conversation.id);
  const history: ChatMessage[] = allMessages.filter((message) => message.id !== userMessage.id).map((message) => ({ role: message.role, content: message.content }));
  const activeQuiz = activeQuizSession(db, conversation.id);
  const route = await normalizeRoute(payload, activeQuiz, history);
  const plan = templatePlan(route);
  yield event("plan", { agent: "main", tasks: plan.tasks, acceptance: plan.acceptance });
  yield event("progress", { phase: "planning", agent: "main", status: "completed", detail: "需求已确定，开始执行。" });
  yield event("route", { action: route.action, resource_type: route.resource_type || null, topic: route.topic || "" });

  let action = route.action;
  let skill: ReturnType<typeof skillByName>;
  let quizState: QuizSession | undefined;
  let fullText = "";

  try {
    if (action === "resource") {
      yield event("progress", { phase: "subagent", agent: route.resource_type, status: "running", detail: `${route.resource_type} 正在生成资源。` });
      const topic = route.topic || payload.message;
      const anchors = getAnchorContext(listUnderstandings(db, student.id), topic);
      const resource = insertResource(db, { studentId: student.id, conversationId: conversation.id, type: route.resource_type || "lecture", title: `${route.resource_type ? ({ lecture: "讲解文档", mindmap: "思维导图", reading: "拓展阅读", code: "代码实操" } as Record<string, string>)[route.resource_type] : "学习资源"}：${topic}`, content: {}, status: "processing" });
      let finalResource;
      try {
        finalResource = updateResource(db, resource.id, { content: await generateResourceContent(route.resource_type || "lecture", topic, history, payload.model, {}, anchors), status: "completed" });
      } catch (error) {
        finalResource = updateResource(db, resource.id, { content: { error: error instanceof Error ? error.message : String(error) }, status: "failed" });
      }
      fullText = formatResourcePreview(finalResource);
      yield event("token", { text: fullText });
      yield event("resource", { id: finalResource.id, type: finalResource.type, title: finalResource.title, file_url: finalResource.file_url });
      yield event("progress", { phase: "subagent", agent: route.resource_type, status: "completed", detail: "资源生成完成。" });
    } else if (action === "tutor") {
      yield event("progress", { phase: "subagent", agent: "tutor", status: "running", detail: "辅导老师正在组织解答。" });
      const result = await tutorAnswer(payload.message, payload.context || "", route.video_topic ? "video" : "text", payload.model);
      fullText = result.text; yield event("token", { text: fullText });
      yield event("progress", { phase: "subagent", agent: "tutor", status: "completed", detail: "辅导回答已完成。" });
    } else if (action === "quiz_session") {
      yield event("progress", { phase: "quiz_session", agent: "quiz_session", status: "running", detail: "互动刷题中，正在出题/批改…" });
      const result = await quizTurn(db, student.id, conversation.id, payload, history, route.topic || payload.message);
      fullText = result.text; quizState = result.session;
      if (fullText) yield event("token", { text: fullText });
      yield event("quiz", result.quizEvent);
      yield event("progress", { phase: "quiz_session", agent: "quiz_session", status: "completed", detail: String(result.quizEvent.action) === "question" ? "已出题/批改完成。" : "本轮练习结束。" });
    } else {
      yield event("progress", { phase: "main", agent: "main", status: "running", detail: "主 Agent 正在直接生成回答。" });
      const anchor = getAnchorContext(listUnderstandings(db, student.id), route.topic || payload.message);
      const context = [payload.context || "", anchor].filter(Boolean).join("\n\n");
      const messages = conversationMessages(history, payload.message, context);
      const tool = useSkillTool();
      const toolCalls: ToolCall[] = [];
      if (hasUsableModel(payload.model)) {
        for await (const chunk of chatStream(payload.model, messages, { temperature: 0.7, maxTokens: 3072, tools: tool ? [tool] : undefined })) {
          if (chunk.type === "token") { fullText += chunk.text; yield event("token", { text: chunk.text }); }
          else toolCalls.push(...chunk.calls);
        }
      } else {
        fullText = fallbackChat(payload.message); yield event("token", { text: fullText });
      }
      const skillCall = findUseSkillCall(toolCalls);
      if (skillCall) {
        const invoked = skillByName(skillCall.skill);
        if (invoked?.enabled) {
          skill = invoked; action = "skill";
          yield event("skill", { skill: invoked.name, title: invoked.title, description: invoked.description });
          yield event("route", { action: "skill", skill: invoked.name, topic: skillCall.topic || payload.message });
          yield event("progress", { phase: "skill", agent: "skill", status: "running", detail: `正在使用技能「${invoked.title}」处理你的请求。` });
          const skillMessages = conversationMessages(history, payload.message, `${context}\n\n当前技能「${invoked.title}」的完整执行说明：\n${invoked.content}`);
          let skillText = "";
          if (hasUsableModel(payload.model)) {
            for await (const chunk of chatStream(payload.model, skillMessages, { temperature: 0.7, maxTokens: 3072 })) if (chunk.type === "token") { skillText += chunk.text; yield event("token", { text: chunk.text }); }
          }
          if (skillText) fullText += skillText;
          yield event("progress", { phase: "skill", agent: "skill", status: "completed", detail: "技能执行完成，准备验收。" });
        }
      }
      yield event("progress", { phase: "main", agent: "main", status: "completed", detail: "主 Agent 已完成直接回答，准备验收。" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fullText = fullText || `⚠️ 请求处理失败：${message}`;
    yield event("token", { text: fullText });
    yield event("error", { message });
  }

  const assistant = insertMessage(db, {
    conversationId: conversation.id,
    role: "assistant",
    content: fullText,
    meta: { mode: payload.mode || "chat", action, skill: skill?.name || null, quiz_session: quizState || null, terms: [], model_id: payload.model?.id || null, main_plan: { tasks: plan.tasks, acceptance: plan.acceptance } },
  });
  yield event("done", { conversation_id: conversation.id, student_id: student.id });

  let terms: ReturnType<typeof extractTerms> = [];
  if (["chat", "tutor", "skill"].includes(action) && fullText.trim().length >= 24) terms = extractTerms(fullText);
  const acceptance = { accepted: Boolean(fullText.trim()), reason: fullText.trim() ? "结果非空，已通过基础验收" : "没有返回内容" };
  yield event("acceptance", { agent: "main", ...acceptance });
  yield event("progress", { phase: "acceptance", agent: "main", status: acceptance.accepted ? "completed" : "failed", detail: acceptance.reason });
  if (terms.length) yield event("terms", { terms });
  const updatedMeta = { mode: payload.mode || "chat", action, skill: skill?.name || null, quiz_session: quizState || null, terms, model_id: payload.model?.id || null, main_plan: { tasks: plan.tasks, acceptance: plan.acceptance }, acceptance };
  db.run("UPDATE messages SET meta = ? WHERE id = ?", [json(updatedMeta), assistant.id]);
}

export async function modelRouteTest(model: ChatRequest["model"]): Promise<{ ok: boolean; model: string; message: string; preview?: string; detail?: string }> {
  if (!model) throw new HttpError(400, "模型配置不能为空");
  const { testModel } = await import("./llm.ts");
  return testModel(model);
}
