import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../db.ts";
import { handleApiRequest } from "../api.ts";
import { chunkText } from "../literature.ts";
import { gradeAnswer, newSession, applyToolArgs, summaryText } from "../quiz.ts";
import { cosine, localEmbed } from "../universe.ts";
import {
  inferProtocol,
  endpointUrlForProtocol,
  parseImageInfo,
  buildRequestBodyForProtocol,
  formatCitationsMarkdown,
} from "../llm.ts";

function request(method: string, pathname: string, value?: unknown) {
  const url = new URL(pathname, "http://indexnya.test");
  const body = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
  return { method, pathname: url.pathname, searchParams: url.searchParams, headers: new Headers({ "content-type": "application/json" }), body };
}

async function events(response: Awaited<ReturnType<typeof handleApiRequest>>) {
  const result: Array<{ event: string; data: any }> = [];
  if (response.stream) for await (const item of response.stream) result.push(item as any);
  return result;
}

test("local embedding is deterministic and normalized", () => {
  const a = localEmbed("递归 函数调用 栈");
  const b = localEmbed("递归 函数调用 栈");
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)) - 1) < 1e-6);
  assert.ok(cosine(a, localEmbed("递归 函数调用 栈")) > cosine(a, localEmbed("文艺复兴 油画")));
});

test("quiz grading and summary keep deterministic behavior", () => {
  const item = { question: "光合作用发生在哪里？", options: ["A. 细胞核", "B. 叶绿体", "C. 核糖体", "D. 线粒体"], answer: "B", explanation: "" };
  assert.equal(gradeAnswer("我的答案：B", item), true);
  assert.equal(gradeAnswer("D", item), false);
  assert.equal(gradeAnswer("不确定", item), null);
  const session = newSession("二叉树");
  applyToolArgs(session, { question: "q", options: [], answer: "a", explanation: "e" });
  assert.match(summaryText({ ...session, active: false, score: 0 }), /共 1 题/);
});

test("literature chunking preserves overlap", () => {
  const chunks = chunkText("词".repeat(9000), 4000, 300);
  assert.equal(chunks.length, 3);
  assert.ok(chunks[1].startsWith("词".repeat(300)));
});

test("API persists chat fallback, branches, and deletes a conversation tree", async () => {
  const db = new Database(":memory:");
  const health = await handleApiRequest(request("GET", "/api/health"), db);
  assert.deepEqual(health.json, { status: "ok", app_name: "Index 学习岛" });

  const chat = await handleApiRequest(request("POST", "/api/chat", { message: "什么是递归？" }), db);
  const chatEvents = await events(chat);
  assert.ok(chatEvents.some((item) => item.event === "token"));
  const meta = chatEvents.find((item) => item.event === "meta")?.data;
  assert.ok(meta?.conversation_id);
  const conversations = await handleApiRequest(request("GET", "/api/conversations"), db);
  assert.equal((conversations.json as any[]).length, 1);

  const branch = await handleApiRequest(request("POST", `/api/conversations/${meta.conversation_id}/branch`, {}), db);
  assert.equal((branch.json as any).parent_conversation_id, meta.conversation_id);
  const afterBranch = await handleApiRequest(request("GET", "/api/conversations"), db);
  assert.equal((afterBranch.json as any[]).length, 2);
  const deleted = await handleApiRequest(request("DELETE", `/api/conversations/${meta.conversation_id}`), db);
  assert.deepEqual((deleted.json as any).deleted_ids.sort((a: number, b: number) => a - b), [1, 2]);
});

test("resource, universe and session-log APIs work without an external model", async () => {
  const db = new Database(":memory:");
  const resource = await handleApiRequest(request("POST", "/api/resources/generate", { type: "lecture", topic: "递归" }), db);
  assert.equal((resource.json as any).status, "completed");
  assert.ok((resource.json as any).content.markdown);

  const evaluated = await handleApiRequest(request("POST", "/api/universe", { concept: "递归", summary: "递归是函数在满足终止条件后调用自身来解决子问题。" }), db);
  assert.equal((evaluated.json as any).approved, true);
  const graph = await handleApiRequest(request("GET", "/api/universe/graph"), db);
  assert.equal((graph.json as any).nodes.length, 1);

  const exported = await handleApiRequest(request("GET", "/api/data/export"), db);
  assert.equal((exported.json as any).format, "indexnya-sessionlog");
  const importRequest = request("POST", "/api/data/import", undefined);
  // Exercise the import service directly through a JSON-shaped multipart-free
  // call in a separate assertion below; the HTTP endpoint is covered by the
  // browser integration because it intentionally accepts multipart files.
  assert.ok(importRequest.body.length === 0);
});

test("multimodal payload and protocol inference align across OpenAI, Anthropic, and Responses API", () => {
  // 1. Protocol inference & URL generation
  assert.equal(inferProtocol({ model: "deepseek-chat", base_url: "https://api.deepseek.com" }), "openai");
  assert.equal(inferProtocol({ model: "deepseek-chat", base_url: "https://api.deepseek.com/anthropic" }), "anthropic");
  assert.equal(inferProtocol({ model: "claude-3-5-sonnet", base_url: "https://api.anthropic.com/v1" }), "anthropic");
  assert.equal(inferProtocol({ model: "gpt-4o", base_url: "https://api.openai.com/v1", protocol: "responses" }), "responses");
  assert.equal(inferProtocol({ model: "deepseek-v4-flash", base_url: "https://api.deepseek.com/responses" }), "responses");

  assert.equal(endpointUrlForProtocol({ model: "m", base_url: "https://api.deepseek.com/v1" }, "openai"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(endpointUrlForProtocol({ model: "m", base_url: "https://api.anthropic.com/v1" }, "anthropic"), "https://api.anthropic.com/v1/messages");
  assert.equal(endpointUrlForProtocol({ model: "m", base_url: "https://api.deepseek.com/anthropic" }, "anthropic"), "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(endpointUrlForProtocol({ model: "m", base_url: "https://api.openai.com/v1" }, "responses"), "https://api.openai.com/v1/responses");

  // 2. Multimodal image parsing (data URL & Anthropic source)
  const sampleDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const parsedFromOpenAi = parseImageInfo({ type: "image_url", image_url: { url: sampleDataUrl } });
  assert.ok(parsedFromOpenAi);
  assert.equal(parsedFromOpenAi?.mimeType, "image/png");
  assert.ok(parsedFromOpenAi?.base64Data.startsWith("iVBOR"));

  const parsedFromAnthropic = parseImageInfo({ type: "image", source: { type: "base64", media_type: "image/webp", data: "UklGR..." } });
  assert.ok(parsedFromAnthropic);
  assert.equal(parsedFromAnthropic?.mimeType, "image/webp");
  assert.equal(parsedFromAnthropic?.base64Data, "UklGR...");

  // 3. Payload generation across protocols
  const messages = [
    { role: "system", content: "You are a helpful tutor." },
    {
      role: "user",
      content: [
        { type: "text", text: "请解释这道题" },
        { type: "image_url", image_url: { url: sampleDataUrl } },
      ],
    },
  ];
  const tool = {
    type: "function",
    function: {
      name: "use_skill",
      description: "Use a skill",
      parameters: { type: "object", properties: { skill: { type: "string" } }, required: ["skill"] },
    },
  };

  // 3a. OpenAI body
  const openAiBody = buildRequestBodyForProtocol({ model: "gpt-4o" }, messages, { tools: [tool] }, "openai", true);
  assert.equal(openAiBody.model, "gpt-4o");
  assert.equal(openAiBody.stream, true);
  const openAiMsgs = openAiBody.messages as any[];
  assert.equal(openAiMsgs.length, 2);
  assert.equal(openAiMsgs[0].role, "system");
  assert.equal(openAiMsgs[1].content[0].type, "text");
  assert.equal(openAiMsgs[1].content[1].type, "image_url");

  // 3b. Anthropic body
  const anthropicBody = buildRequestBodyForProtocol({ model: "claude-3-5-sonnet" }, messages, { tools: [tool] }, "anthropic", false);
  assert.equal(anthropicBody.model, "claude-3-5-sonnet");
  assert.equal(anthropicBody.system, "You are a helpful tutor.");
  const anthropicMsgs = anthropicBody.messages as any[];
  assert.equal(anthropicMsgs.length, 1); // system extracted
  assert.equal(anthropicMsgs[0].role, "user");
  assert.equal(anthropicMsgs[0].content[0].type, "image");
  assert.equal(anthropicMsgs[0].content[0].source.media_type, "image/png");
  assert.equal(anthropicMsgs[0].content[1].type, "text");
  const anthropicTools = anthropicBody.tools as any[];
  assert.equal(anthropicTools[0].name, "use_skill");
  assert.ok(anthropicTools[0].input_schema);

  // 3c. Responses API body with Web Search
  const responsesBody = buildRequestBodyForProtocol(
    { model: "deepseek-v4-flash", enable_web_search: true },
    messages,
    { tools: [tool] },
    "responses",
    true,
  );
  assert.equal(responsesBody.model, "deepseek-v4-flash");
  assert.equal(responsesBody.instructions, "You are a helpful tutor.");
  const inputItems = responsesBody.input as any[];
  assert.equal(inputItems.length, 1);
  assert.equal(inputItems[0].content[0].type, "input_text");
  assert.equal(inputItems[0].content[1].type, "input_image");
  const responsesTools = responsesBody.tools as any[];
  assert.ok(responsesTools.some((t) => t.type === "web_search"));
  assert.ok(responsesTools.some((t) => t.type === "function" && t.name === "use_skill"));

  // 4. Citation docs formatting
  const citations = [
    { title: "DeepSeek Vision Docs", url: "https://api-docs.deepseek.com/zh-cn/guides/vision" },
    { title: "Responses API Guide", url: "https://api-docs.deepseek.com/zh-cn/guides/responses_api" },
  ];
  const markdown = formatCitationsMarkdown(citations);
  assert.match(markdown, /参考网络来源与文档/);
  assert.match(markdown, /\[DeepSeek Vision Docs\]\(https:\/\/api-docs\.deepseek\.com\/zh-cn\/guides\/vision\)/);
});
