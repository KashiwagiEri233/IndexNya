import type { JsonObject } from "./types.ts";

export const SESSION_KEY = "quiz_session";

export const QUIZ_TOOL = {
  type: "function",
  function: {
    name: "ask_question",
    description: "向学生出一道练习题并等待学生作答。每次调用只能出一道题；出完题必须停下等学生回答，不要连续调用。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "本题题目内容（题干）" },
        options: { type: "array", items: { type: "string" }, description: "选择题选项；简答题传空数组 []" },
        answer: { type: "string", description: "本题正确答案" },
        explanation: { type: "string", description: "答案解析" },
        previous_correct: { type: "boolean", description: "学生上一题是否回答正确（第一题可不填）" },
        previous_feedback: { type: "string", description: "对上一题回答的简明点评（第一题可不填）" },
      },
      required: ["question", "answer", "explanation"],
    },
  },
} as const;

export const QUIZ_SYSTEM_PROMPT = `你是「互动刷题」辅导员，负责一题一题地给学生出练习题、即时批改并深入讲解。

规则：
1. 【正文回复】只用于点评学生上一题；第一题简要说明主题与题量。下一题题干和选项只能通过 ask_question 工具提供。
2. 每轮必须且只能调用一次 ask_question 出一道新题，出完立即停下等待回答。
3. 选择题 options 必须包含 4 个完整选项字符串；简答题传空数组 []。
4. 难度循序渐进，结合上一题的答题情况强化薄弱点。
5. 全部 5 道题答完或学生明确退出时，只总结，不再调用工具。
6. 全程使用中文，语气专业亲切、积极鼓励。`;

const QUIZ_EXIT_PATTERN = /(?:结束|不做了|不练了|不做题了|退出|够了|就(?:到|练)这|今天(?:就)?到这|不想练|暂停|到此为止)/;

export interface QuizItem {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  correct: boolean | null;
}

export interface QuizSession {
  active: boolean;
  topic: string;
  index: number;
  score: number;
  total: number;
  items: QuizItem[];
}

export function newSession(topic = ""): QuizSession {
  return { active: true, topic: topic.slice(0, 60), index: 0, score: 0, total: 5, items: [] };
}

export function isQuizExit(text: string): boolean {
  return QUIZ_EXIT_PATTERN.test((text || "").trim());
}

export function applyToolArgs(session: QuizSession, args: Record<string, unknown>): void {
  const previous = args.previous_correct;
  if (typeof previous === "boolean") session.score += previous ? 1 : 0;
  session.index += 1;
  if (args.total !== undefined && Number.isFinite(Number(args.total))) session.total = Number(args.total);
  session.items.push({
    question: String(args.question || ""),
    options: Array.isArray(args.options) ? args.options.map(String) : [],
    answer: String(args.answer || ""),
    explanation: String(args.explanation || ""),
    correct: typeof previous === "boolean" ? previous : null,
  });
}

export function closeSession(session: QuizSession): void {
  session.active = false;
}

export function serializeSession(session: QuizSession): QuizSession {
  return {
    active: Boolean(session.active),
    topic: session.topic || "",
    index: Number(session.index || 0),
    score: Number(session.score || 0),
    total: Number(session.total || 5),
    items: Array.isArray(session.items) ? session.items : [],
  };
}

export function summaryText(session: QuizSession): string {
  const index = Number(session.index || 0);
  const score = Number(session.score || 0);
  const rate = index > 0 ? score / index : 0;
  const lines = [`✅ 本轮练习结束：共 ${index} 题，答对 ${score} 题，正确率 ${rate.toLocaleString("zh-CN", { style: "percent", maximumFractionDigits: 0 })}。`];
  if (session.topic?.trim()) lines.push(`主题：${session.topic.trim()}`);
  lines.push("如需继续练习，请说「再来几题」。");
  return lines.join("\n");
}

function repairAndLoadJson(raw: string): Record<string, unknown> | undefined {
  let text = (raw || "").trim();
  if (!text) return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // Try repairing a truncated response below.
  }
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let fragment = text.slice(start);
  const quoteCount = (fragment.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2) fragment += '"';
  const openBrackets = (fragment.match(/\[/g) || []).length - (fragment.match(/\]/g) || []).length;
  if (openBrackets > 0) fragment += "]".repeat(openBrackets);
  const openBraces = (fragment.match(/\{/g) || []).length - (fragment.match(/\}/g) || []).length;
  if (openBraces > 0) fragment += "}".repeat(openBraces);
  try {
    const data = JSON.parse(fragment) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // Regex fallback below.
  }
  return undefined;
}

export function parseAskQuestionArgs(raw: string): Record<string, unknown> | undefined {
  const data = repairAndLoadJson(raw);
  if (data?.question) {
    data.options = Array.isArray(data.options) ? data.options : [];
    return data;
  }
  const text = String(raw || "");
  const question = text.match(/"question"\s*:\s*"((?:[^"\\]|\\.)+)/i)?.[1];
  if (!question) return undefined;
  const decode = (value: string | undefined) => {
    if (!value) return "";
    try { return JSON.parse(`"${value}"`) as string; } catch { return value; }
  };
  const optionsRaw = text.match(/"options"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || "";
  const options = [...optionsRaw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => decode(m[1]));
  const answer = text.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/i)?.[1];
  const explanation = text.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)/i)?.[1];
  const correct = text.match(/"previous_correct"\s*:\s*(true|false)/i)?.[1];
  const feedback = text.match(/"previous_feedback"\s*:\s*"((?:[^"\\]|\\.)*)/i)?.[1];
  return {
    question: decode(question), options, answer: decode(answer), explanation: decode(explanation),
    previous_correct: correct ? correct.toLowerCase() === "true" : undefined,
    previous_feedback: decode(feedback),
  };
}

export function findAskQuestion(toolCalls: Array<{ name?: string; arguments?: string }>): Record<string, unknown> | undefined {
  for (const call of toolCalls || []) {
    if (call.name === "ask_question" || call.name === "functions.ask_question") {
      const parsed = parseAskQuestionArgs(call.arguments || "{}");
      if (parsed) return parsed;
    }
  }
  return undefined;
}

const ANSWER_PREFIX_RE = /^(?:我的答案|我选的|答案|选)[：:\s]*/i;
const OPTION_PREFIX_RE = /^[A-Da-d][.、)）:\s]\s*/;
const LETTER_RE = /(?<![A-Za-z])([A-Da-d])(?![A-Za-z])/;
const ANSWER_LETTER_RE = /^\s*([A-Da-d])\s*[.、)）:\s]/;

function normalizeAnswerText(value: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(ANSWER_PREFIX_RE, "")
    .replace(OPTION_PREFIX_RE, "")
    .replace(/[，。！？、；;：:\s\-—~～()（）\[\]【】"'“”‘’]/g, "");
}

function extractChoiceLetter(value: string): string | undefined {
  const letter = value.match(LETTER_RE)?.[1]?.toUpperCase();
  return letter && "ABCD".includes(letter) ? letter : undefined;
}

export function gradeAnswer(userText: string, item?: Partial<QuizItem> | null): boolean | null {
  if (!item) return null;
  const answer = String(item.answer || "").trim();
  const text = (userText || "").trim();
  if (!answer || !text) return null;
  const options = Array.isArray(item.options) ? item.options : [];
  const normalizedAnswer = normalizeAnswerText(answer);
  const isChoice = options.length > 0 || ANSWER_LETTER_RE.test(answer);
  const answerLetter = isChoice ? extractChoiceLetter(answer) : undefined;

  if (options.length) {
    const userNorm = normalizeAnswerText(text);
    let matched: string | undefined;
    for (const option of options) {
      const optionNorm = normalizeAnswerText(String(option));
      if (userNorm && optionNorm && userNorm === optionNorm) { matched = String(option); break; }
    }
    if (!matched) {
      for (const option of options) {
        const optionNorm = normalizeAnswerText(String(option));
        if (userNorm && optionNorm && (optionNorm.includes(userNorm) || userNorm.includes(optionNorm))) { matched = String(option); break; }
      }
    }
    if (matched) {
      const optionLetter = extractChoiceLetter(matched);
      if (answerLetter) return optionLetter === answerLetter;
      if (normalizedAnswer && normalizeAnswerText(matched) === normalizedAnswer) return true;
      return null;
    }
    const userLetter = extractChoiceLetter(text);
    if (userLetter && answerLetter) return userLetter === answerLetter;
  }

  const normalizedText = normalizeAnswerText(text);
  if (!normalizedText || !normalizedAnswer) return null;
  if (normalizedText === normalizedAnswer) return true;
  if (isChoice && (normalizedAnswer.includes(normalizedText) || normalizedText.includes(normalizedAnswer))) return true;
  return null;
}

export function tryExtractQuestionFromText(text: string): Record<string, unknown> | undefined {
  const raw = (text || "").trim();
  if (!raw) return undefined;
  const optionMatches = [...raw.matchAll(/(?:^|\n)\s*([A-D][.、\s\)].*?)(?=(?:\n\s*[A-D][.、\s\)])|$)/gs)].map((m) => m[1].trim());
  if (optionMatches.length >= 2) {
    const first = raw.indexOf(optionMatches[0]);
    const lines = raw.slice(0, first).split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length) {
      const question = lines.at(-1)!.replace(/^(?:下一题[：:]?|第[一二三四五六七八九十0-9]+题[：:]?|题目[：:]?|\d+[.、]\s*)/, "").trim();
      if (question) {
        return {
          question, options: optionMatches.slice(0, 4), answer: "", explanation: "",
          previous_correct: /回答正确|答对|✅|❌|回答错误/.test(raw) ? !/回答错误|❌/.test(raw) : undefined,
        };
      }
    }
  }
  const match = raw.match(/(?:下一题[：:]|请问[：:]?|思考题[：:]?|第\s*[一二三四五六七八九十0-9]+\s*题[：:\s])([\s\S]+)$/);
  if (match) {
    const question = match[1].trim();
    if (question.length >= 5 && question.length <= 500 && !/练习结束|小结|总结/.test(question)) {
      return { question, options: [], answer: "", explanation: "", previous_correct: undefined };
    }
  }
  return undefined;
}

/** Offline fallback question so the app remains testable without a configured model. */
export function fallbackQuestion(topic: string, index: number): Record<string, unknown> {
  const clean = topic.trim() || "当前主题";
  const bank = [
    { question: `关于「${clean}」，下面哪项最适合作为核心学习目标？`, options: ["A. 记住所有定义", "B. 理解概念并能举例应用", "C. 只背诵关键词", "D. 跳过基础直接刷题"], answer: "B", explanation: "理解概念并能在新情境中应用，比机械记忆更能检验学习效果。" },
    { question: `请用自己的话解释「${clean}」解决的主要问题。`, options: [], answer: `围绕${clean}说明它要解决的问题`, explanation: "回答时可以从问题背景、核心机制和一个具体例子三个角度组织。" },
    { question: `学习「${clean}」时，为什么需要先明确前置概念？`, options: [], answer: "因为前置概念构成理解新知识的基础", explanation: "知识具有依赖关系，补齐前置概念能降低后续学习的认知负担。" },
  ];
  return { ...bank[index % bank.length], previous_correct: undefined };
}

export function isQuizSession(value: unknown): value is QuizSession {
  return Boolean(value && typeof value === "object" && (value as JsonObject).active !== undefined && Array.isArray((value as JsonObject).items));
}
