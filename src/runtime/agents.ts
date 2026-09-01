import type { ChatMessage, JsonObject, ModelConfig, ToolCall } from "./types.ts";
import { chatComplete, chatCompleteText, chatStream, hasUsableModel } from "./llm.ts";
import { getSkill, listSkills, type Skill } from "./skills.ts";
import { getAnchorContext } from "./universe.ts";

export type RouteAction = "chat" | "tutor" | "resource" | "quiz_session" | "skill";

export interface RouteDecision {
  action: RouteAction;
  resource_type?: "lecture" | "mindmap" | "reading" | "code";
  topic: string;
  video_topic?: string;
}

const RESOURCE_PROMPTS: Record<string, string> = {
  lecture: `你是一位资深高校教师。请用中文 Markdown 为学生生成「{topic}」的结构化课程讲解文档。
包含：目标、前置知识、核心概念、原理/公式或图示、易错点（标注 ⚠ 易错）、例子、思考题和学习路径。不要包裹代码块。`,
  mindmap: `你是一位知识可视化专家。请为「{topic}」生成 Markdown 思维导图大纲。
使用 # / ## / ### 标题和 - 列表表示 3-4 层结构，每个节点少于 15 字，用 | 分隔并列要点。只输出大纲，不要解释。`,
  reading: `你是一位学习资料策展人。请为「{topic}」整理中文拓展阅读清单。
按入门、进阶、实践分组，介绍每项适合解决的问题和阅读顺序；不要编造无法确认的链接，必要时给出检索关键词。使用 Markdown。`,
  code: `你是一位工程导师。请围绕「{topic}」生成可运行的代码实操案例（优先 Python 或 JavaScript）。
包含目标、环境与依赖、完整代码、逐段解读、运行与预期输出、练习扩展和常见 Bug。使用 Markdown。`,
};

const RESOURCE_LABELS: Record<string, string> = { lecture: "讲解文档", mindmap: "思维导图", reading: "拓展阅读", code: "代码实操" };

const KEYWORD_ROUTES: Array<{ pattern: RegExp; action: RouteAction; resourceType?: RouteDecision["resource_type"] }> = [
  { pattern: /(?:重新|重练|重做|把|用).{0,8}(?:错题|这些题)/, action: "quiz_session" },
  { pattern: /(?:生成|制作|做份?|创建|写|出|给我|帮我|整理|梳理).{0,8}(?:讲解(?:文档|讲义)|讲义|教学文档|讲解资料|课件)/, action: "resource", resourceType: "lecture" },
  { pattern: /(?:生成|画|做份?|给我|帮我|整理|梳理|列).{0,8}(?:思维导图|脑图|知识(?:结构|框架|树))/, action: "resource", resourceType: "mindmap" },
  { pattern: /(?:生成|推荐|给我|帮我|找|整理).{0,8}(?:拓展阅读|阅读材料|参考文献?|书单|参考书|学习资料)/, action: "resource", resourceType: "reading" },
  { pattern: /(?:推荐|给我|帮我|找).{0,12}书(?=[单籍本]?\s*$|[，。！？])/, action: "resource", resourceType: "reading" },
  { pattern: /(?:生成|写|实现|做份?|给我|帮我).{0,8}(?:代码(?:案例|示例)?|小程序|脚本|demo)/i, action: "resource", resourceType: "code" },
  { pattern: /(?:生成|出|做份?|给我|帮我|编|刷|做|考|练习).{0,8}(?:题目|练习题|习题|测试题|试卷|考卷)|(?:刷题|逐题|一题一题|互动练习|来几道题|出题考(?:考|我)|考考我|陪我练|练(?:习|一练).{0,6}(?:题|练))/, action: "quiz_session" },
];

export function keywordRoute(message: string): RouteDecision | undefined {
  const text = (message || "").trim();
  if (!text) return undefined;
  const match = KEYWORD_ROUTES.find((item) => item.pattern.test(text));
  if (!match) return undefined;
  const route: RouteDecision = { action: match.action, topic: text.slice(0, 40) };
  if (match.resourceType) route.resource_type = match.resourceType;
  return route;
}

function parseJsonObject(raw: string): JsonObject | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const text = fenced?.[1] || raw;
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
  } catch { return undefined; }
}

const ROUTE_LIGHT_PROMPT = `你是意图分类器，只判断用户请求应交给哪个功能，绝不回答问题本身。
只输出 JSON：{"action":"chat|tutor|resource|quiz_session","resource_type":"lecture|mindmap|reading|code|null","topic":"简短主题"}
明确生成资料时用 resource；想做题/刷题时用 quiz_session；具体疑问用 tutor；其余用 chat。`;

export async function routeLight(message: string, history: ChatMessage[], model?: ModelConfig): Promise<RouteDecision> {
  if (hasUsableModel(model)) {
    try {
      const recent = history.slice(-4).map((item) => `${item.role}: ${String(item.content).slice(0, 200)}`).join("\n");
      const raw = await chatCompleteText(model, [{ role: "system", content: ROUTE_LIGHT_PROMPT }, { role: "user", content: `最近对话：${recent}\n当前请求：${message}` }], { temperature: 0, maxTokens: 150 });
      const data = parseJsonObject(raw);
      const action = String(data?.action || "chat").toLowerCase() as RouteAction;
      const allowed: RouteAction[] = ["chat", "tutor", "resource", "quiz_session"];
      const safeAction = allowed.includes(action) ? action : "chat";
      const resource = String(data?.resource_type || "").toLowerCase() as RouteDecision["resource_type"];
      const validResource = resource && ["lecture", "mindmap", "reading", "code"].includes(resource) ? resource : undefined;
      return { action: safeAction === "resource" && !validResource ? "chat" : safeAction, resource_type: validResource, topic: String(data?.topic || message.slice(0, 20)).trim() };
    } catch {
      // Local fallback below.
    }
  }
  if (/[?？]|什么是|怎么|如何|为什么|请解释|帮我理解/.test(message)) return { action: "tutor", topic: message.slice(0, 40) };
  return { action: "chat", topic: message.slice(0, 40) };
}

export function templatePlan(route: RouteDecision): JsonObject {
  if (route.action === "resource") return { action: route.action, topic: route.topic, resource_type: route.resource_type, tasks: [{ agent: route.resource_type, instruction: "完成当前请求" }], acceptance: ["结果与用户请求相关", "结果可以直接展示给用户"] };
  if (route.action === "quiz_session") return { action: route.action, topic: route.topic, tasks: [{ agent: "quiz_session", instruction: "逐题向学生出练习题并批改讲解" }], acceptance: ["逐题出题", "每道题给出点评与解析"] };
  if (route.action === "tutor") return { action: route.action, topic: route.topic, tasks: [{ agent: "tutor", instruction: "完成当前辅导任务" }], acceptance: ["回答与用户问题相关", "结论清晰且没有空结果"] };
  return { action: "chat", topic: route.topic, tasks: [{ agent: "main", instruction: "由主 Agent 直接回答当前学习问题" }], acceptance: ["回答与用户问题相关", "结论清晰且没有空结果"] };
}

export function buildSkillsPrompt(): string {
  const enabled = listSkills().filter((skill) => skill.enabled);
  if (!enabled.length) return "";
  return [
    "## 可用技能",
    "你拥有可按需加载的 SKILL.md 专用执行手册。用户明确提到技能名或请求明显匹配描述时，先调用 use_skill。",
    "### 技能清单",
    ...enabled.map((skill) => `- **${skill.name}**：${skill.description || "无描述"}`),
    "### 技能规则",
    "1. 只加载当前任务需要的技能；2. 加载后严格遵循完整指令；3. 无法应用时说明原因并继续回答。",
  ].join("\n\n");
}

export function useSkillTool(): JsonObject | undefined {
  const skills = listSkills().filter((skill) => skill.enabled);
  if (!skills.length) return undefined;
  return {
    type: "function",
    function: {
      name: "use_skill",
      description: "加载与当前请求匹配的技能完整执行指令",
      parameters: { type: "object", properties: { skill: { type: "string", enum: skills.map((skill) => skill.name) }, topic: { type: "string" } }, required: ["skill"] },
    },
  };
}

export function findUseSkillCall(calls: ToolCall[]): { skill: string; topic?: string } | undefined {
  for (const call of calls || []) {
    if (call.name !== "use_skill") continue;
    try {
      const data = JSON.parse(call.arguments || "{}") as JsonObject;
      if (data.skill) return { skill: String(data.skill), topic: data.topic ? String(data.topic) : undefined };
    } catch { /* ignore malformed tool calls */ }
  }
  return undefined;
}

export function conversationMessages(history: ChatMessage[], message: string, context = ""): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: "你是 Index 学习岛的主 Agent，同时负责直接回答普通学习对话。请用中文、结构清晰地回答；必要时使用 Markdown、数学公式和例子。不要提及内部工作流程。" }];
  const skills = buildSkillsPrompt();
  if (skills) messages.push({ role: "system", content: skills });
  if (context) messages.push({ role: "system", content: `当前子对话聚焦上下文：${context.slice(0, 4000)}` });
  messages.push(...history.slice(-20));
  messages.push({ role: "user", content: message });
  return messages;
}

export async function generateResourceContent(type: string, topic: string, history: ChatMessage[], model?: ModelConfig, extra: JsonObject = {}, anchorContext = ""): Promise<JsonObject> {
  const prompt = (RESOURCE_PROMPTS[type] || RESOURCE_PROMPTS.lecture).replaceAll("{topic}", topic);
  const context = [
    history.length ? `对话历史：\n${history.slice(-20).map((item) => `${item.role}: ${String(item.content).slice(0, 1200)}`).join("\n")}` : "",
    Object.keys(extra).length ? `额外要求：${JSON.stringify(extra)}` : "",
    anchorContext,
  ].filter(Boolean).join("\n\n");
  let text = "";
  if (hasUsableModel(model)) {
    text = await chatCompleteText(model, [{ role: "system", content: prompt }, ...(context ? [{ role: "system", content: context }] : []), { role: "user", content: `请生成关于「${topic}」的内容。` }], { temperature: type === "code" ? 0.4 : 0.6, maxTokens: type === "mindmap" ? 3072 : 6144 });
  }
  if (!text.trim()) text = fallbackResourceMarkdown(type, topic);
  if (type === "mindmap") return { markdown: text.trim(), tree: parseMindmapOutline(text, topic) };
  return { markdown: text.trim() };
}

function fallbackResourceMarkdown(type: string, topic: string): string {
  if (type === "mindmap") return `# ${topic}\n## 核心概念\n- 定义\n- 关键原理\n## 学习路径\n- 前置知识\n- 练习与复盘`;
  if (type === "code") return `# ${topic}：最小可运行示例\n\n## 目标\n理解 ${topic} 的基本用法。\n\n## 完整代码\n\`\`\`python\nprint("开始学习：${topic}")\n\`\`\`\n\n## 练习扩展\n1. 修改输入并观察输出。\n2. 为示例增加错误处理。`;
  if (type === "reading") return `# ${topic} 拓展阅读\n\n## 入门\n- 先掌握 ${topic} 的定义、核心问题和最小例子。\n\n## 进阶\n- 对比不同实现，关注适用场景与复杂度。\n\n## 检索关键词\n- ${topic} tutorial\n- ${topic} best practices`;
  return `# ${topic}\n\n## 学习目标\n理解 ${topic} 的基本概念、原理和应用。\n\n## 核心内容\n- 从问题背景出发，说明它解决什么问题。\n- 用一个简单例子验证理解。\n\n## ⚠ 易错\n不要只记结论，要说明条件与适用范围。\n\n## 思考题\n1. ${topic} 与相近概念有什么区别？`;
}

export function parseMindmapOutline(markdown: string, defaultTitle: string): JsonObject {
  const root: JsonObject = { title: defaultTitle, children: [] };
  const stack: Array<{ level: number; node: JsonObject }> = [{ level: 0, node: root }];
  let lastHeading = 0;
  const add = (level: number, node: JsonObject) => {
    while (stack.length > 1 && stack.at(-1)!.level >= level) stack.pop();
    (stack.at(-1)!.node.children as JsonObject[]).push(node);
    stack.push({ level, node });
  };
  for (const raw of markdown.replace(/```(?:markdown)?/gi, "").split(/\r?\n/)) {
    const line = raw.trimEnd(); if (!line.trim()) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length; lastHeading = level;
      while (stack.length > 1 && stack.at(-1)!.level >= level) stack.pop();
      const node: JsonObject = { title: heading[2].trim(), children: [] };
      (stack.at(-1)!.node.children as JsonObject[]).push(node); stack.push({ level, node }); continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet) {
      const level = lastHeading + 1 + Math.floor(bullet[1].length / 2);
      for (const part of bullet[2].split("|").map((item) => item.trim()).filter(Boolean)) add(level, { title: part, children: [] });
      continue;
    }
    if (line.trim()) add(Math.max(1, lastHeading + 1), { title: line.trim(), children: [] });
  }
  return root;
}

export async function tutorAnswer(question: string, context: string, modality: string, model?: ModelConfig): Promise<{ text: string; video_topic?: string; video_url?: string }> {
  const prompt = `你是一位耐心的学习辅导老师。请用中文循序渐进回答学生问题，先判断知识点，再分步骤解释，给出类比、易错点和一个小练习。\n${context ? `相关上下文：${context}` : ""}`;
  let text = hasUsableModel(model) ? await chatCompleteText(model, [{ role: "system", content: prompt }, { role: "user", content: question }], { temperature: 0.5, maxTokens: 3072 }) : "";
  if (!text.trim()) text = `可以把「${question}」拆成三步理解：先明确概念定义，再看它解决的问题，最后用一个小例子验证。建议你把关键条件和结论分别写下来，再尝试举出一个反例。`;
  const marker = text.match(/\[需视频讲解[:：]\s*(.+?)\]/);
  const wantsVideo = modality === "video" || Boolean(marker);
  const topic = (marker?.[1] || question).trim().slice(0, 80);
  if (marker) text = text.replace(marker[0], "").trim();
  if (wantsVideo) return { text: `${text}\n\n📺 Bilibili 相关视频：[搜索「${topic}」](https://search.bilibili.com/all?keyword=${encodeURIComponent(topic)})`, video_topic: topic, video_url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(topic)}` };
  return { text };
}

const GENERIC_TERMS = new Set("这是 这个 一个 一种 可以 需要 如果 因此 所以 通过 进行 以及 相关 其中 这里 主要 例如 说明 问题 方法 内容 学习 学生 过程 结果 时候 可能 应该 比较 关键 核心 具有 使用 下面 上述 之后 当前 直接 进行 由于".split(/\s+/));
const EN_STOP = new Set("the and or for with from that this are was were have has into about your you can will should what when where how why which their there then than also just not use using used more most very some such only each both".split(/\s+/));

function cleanTerm(value: string): string {
  return value.replace(/^[-*#`\s]+|[-*#`\s]+$/g, "").replace(/^[：:，。,、；;]+|[：:，。,、；;]+$/g, "").trim();
}

function isGeneric(term: string): boolean {
  return !term || GENERIC_TERMS.has(term) || term.length > 32 || /^\d+$/.test(term) || /^[，。！？、；：\s]+$/.test(term);
}

function dedupeTerms(items: Array<{ text: string; explanation?: string; relation?: string }>): Array<{ text: string; explanation: string; relation: "background" | "related" }> {
  const output: Array<{ text: string; explanation: string; relation: "background" | "related" }> = [];
  for (const item of items) {
    const text = cleanTerm(item.text);
    if (isGeneric(text) || output.some((existing) => existing.text === text || existing.text.includes(text) || text.includes(existing.text))) continue;
    output.push({ text, explanation: item.explanation || "", relation: item.relation === "related" ? "related" : "background" });
  }
  return output;
}

/** Local deterministic term extraction; it never blocks the chat stream on a second LLM call. */
export function extractTerms(answer: string, maxTerms = 10): Array<{ text: string; explanation: string; relation: "background" | "related" }> {
  if (answer.trim().length < 24) return [];
  const candidates: Array<{ text: string; explanation?: string; relation?: string }> = [];
  for (const match of answer.matchAll(/[A-Za-z][A-Za-z0-9+#.\-]{1,30}/g)) {
    const word = match[0]; const lower = word.toLowerCase();
    if (EN_STOP.has(lower) || (word === word.toLowerCase() && !/[0-9+#.\-]/.test(word)) || /^[a-z0-9-]+\.(com|org|net|io|cn|edu|gov|html?|md|txt|pdf|png|jpg)$/i.test(word)) continue;
    candidates.push({ text: word });
  }
  for (const match of answer.matchAll(/[「『“"']([^「」『』”"'\n]{1,30})[」』”"']/g)) candidates.push({ text: match[1] });
  const splitChars = "与和及或是的在于而之其这那都也很还又就才并且为对";
  for (const match of answer.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = match[0];
    if (run.length <= 4) candidates.push({ text: run });
    else for (const part of run.split(new RegExp(`[${splitChars}]`)).filter((item) => item.length >= 2 && item.length <= 4)) candidates.push({ text: part });
  }
  return dedupeTerms(candidates).slice(0, maxTerms);
}

export function formatResourcePreview(resource: { type: string; title: string; status: string; content: JsonObject }): string {
  const label = RESOURCE_LABELS[resource.type] || resource.type;
  if (resource.status === "failed") return `⚠️ ${label} 生成失败：${String(resource.content.error || "未知错误")}`;
  const header = `✅ 已生成 **${label}**：${resource.title}\n\n`;
  if (resource.content.markdown) return header + String(resource.content.markdown);
  if (resource.content.mermaid) return `${header}\n\`\`\`mermaid\n${String(resource.content.mermaid)}\n\`\`\``;
  return header + "资源已生成。";
}

export function skillByName(name: string): Skill | undefined { return getSkill(name); }
export function anchorContext(rows: Parameters<typeof getAnchorContext>[0], topic: string): string { return getAnchorContext(rows, topic); }
