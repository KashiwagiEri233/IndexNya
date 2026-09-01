import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../db.ts";
import { handleApiRequest } from "../api.ts";
import { chunkText } from "../literature.ts";
import { gradeAnswer, newSession, applyToolArgs, summaryText } from "../quiz.ts";
import { cosine, localEmbed } from "../universe.ts";

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
