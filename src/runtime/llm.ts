import type { ChatMessage, ModelConfig, ToolCall } from "./types.ts";

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  toolChoice?: string | { type: string; function?: { name: string } };
}

export type LlmStreamChunk =
  | { type: "token"; text: string }
  | { type: "tool_calls"; calls: ToolCall[] };

export class LlmError extends Error {
  readonly status?: number;
  readonly responseBody?: string;

  constructor(message: string, status?: number, responseBody?: string) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

const REASONING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function hasUsableModel(model?: ModelConfig | null): model is ModelConfig {
  return Boolean(model?.model?.trim() && model?.base_url?.trim() && model?.api_key?.trim());
}

export function assertUsableModel(model?: ModelConfig | null): asserts model is ModelConfig {
  if (!hasUsableModel(model)) {
    throw new LlmError("未配置可用模型，请先在网页左下角「设置」中添加提供商并选择模型");
  }
}

function completionUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/v\d+$/i.test(url)) return `${url}/chat/completions`;
  return `${url}/chat/completions`;
}

function friendlyError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (lower.includes("<!doctype html") || lower.includes("<html") || lower.includes("404 - page not found")) {
    return "接口返回了网页 404，而不是模型 API 响应。请检查 Base URL，填写 OpenAI 兼容 API 地址，不要填写网页首页地址。";
  }
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const error = parsed.error;
    detail = typeof error === "string" ? error : error?.message || parsed.message || body;
  } catch {
    // Keep the raw response when it is not JSON.
  }
  detail = detail.replace(/\s+/g, " ").trim();
  return detail.length > 500 ? `${detail.slice(0, 500)}…` : detail || `HTTP ${status}`;
}

function requestBody(model: ModelConfig, messages: ChatMessage[], options: ChatCompletionOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    if (options.toolChoice) body.tool_choice = options.toolChoice;
  }
  const effort = model.reasoning_effort?.trim().toLowerCase();
  if (effort && REASONING_LEVELS.has(effort)) {
    // OpenAI-compatible providers differ: most accept the top-level field,
    // while some gateways expect it inside extra_body. Sending both is harmless
    // for providers that ignore unknown fields and preserves old behavior.
    body.reasoning_effort = effort;
    body.extra_body = { reasoning_effort: effort };
  }
  return body;
}

async function fetchCompletion(model: ModelConfig, body: Record<string, unknown>, timeoutMs = 120_000): Promise<Response> {
  assertUsableModel(model);
  const baseUrl = model.base_url;
  const apiKey = model.api_key;
  if (!baseUrl || !apiKey) throw new LlmError("未配置可用模型");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(completionUrl(baseUrl), {
      method: "POST",
      headers: {
        Accept: body.stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LlmError("模型请求超时，请检查网络或模型服务状态");
    }
    throw new LlmError(`模型请求失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) throw new LlmError(`模型请求失败：${friendlyError(response.status, text)}`, response.status, text);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LlmError("模型返回了无法解析的 JSON", response.status, text);
  }
}

function parseToolCalls(message: Record<string, unknown>): ToolCall[] {
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return raw.flatMap((item) => {
    const call = item as Record<string, unknown>;
    const fn = (call.function || {}) as Record<string, unknown>;
    const name = String(fn.name || "").trim();
    if (!name) return [];
    return [{ id: call.id ? String(call.id) : undefined, name, arguments: String(fn.arguments || "{}") }];
  });
}

export async function chatComplete(
  model: ModelConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const response = await fetchCompletion(model, requestBody(model, messages, options, false));
  const data = await responseJson(response);
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const message = ((choices[0] as Record<string, unknown> | undefined)?.message || {}) as Record<string, unknown>;
  const content = typeof message.content === "string" ? message.content : "";
  return { content, toolCalls: parseToolCalls(message) };
}

export async function chatCompleteText(model: ModelConfig, messages: ChatMessage[], options: ChatCompletionOptions = {}): Promise<string> {
  return (await chatComplete(model, messages, options)).content;
}

function parseSseBlock(block: string): { event?: string; data?: string } | undefined {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return undefined;
  return { event, data: dataLines.join("\n") };
}

export async function* chatStream(
  model: ModelConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): AsyncGenerator<LlmStreamChunk> {
  const response = await fetchCompletion(model, requestBody(model, messages, options, true));
  if (!response.ok) {
    const text = await response.text();
    throw new LlmError(`模型请求失败：${friendlyError(response.status, text)}`, response.status, text);
  }
  if (!response.body) throw new LlmError("模型没有返回可读取的流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolParts = new Map<number, { id?: string; name: string; arguments: string }>();

  const consume = async function* (flush = false): AsyncGenerator<LlmStreamChunk> {
    if (flush) buffer += decoder.decode();
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (!parsed?.data || parsed.data === "[DONE]") continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(parsed.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const delta = ((choices[0] as Record<string, unknown> | undefined)?.delta || {}) as Record<string, unknown>;
      if (typeof delta.content === "string" && delta.content) yield { type: "token", text: delta.content };
      const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const raw of calls) {
        const call = raw as Record<string, unknown>;
        const index = Number(call.index ?? toolParts.size);
        const part = toolParts.get(index) || { id: undefined, name: "", arguments: "" };
        if (call.id) part.id = String(call.id);
        const fn = (call.function || {}) as Record<string, unknown>;
        if (fn.name) part.name += String(fn.name);
        if (fn.arguments) part.arguments += String(fn.arguments);
        toolParts.set(index, part);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    yield* consume();
  }
  yield* consume(true);

  if (toolParts.size) {
    yield {
      type: "tool_calls",
      calls: [...toolParts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({ id: call.id, name: call.name, arguments: call.arguments || "{}" })),
    };
  }
}

export async function testModel(model: ModelConfig): Promise<{ ok: boolean; model: string; message: string; preview?: string; detail?: string }> {
  try {
    const preview = await chatCompleteText(
      model,
      [
        { role: "system", content: "请只回复：连接成功" },
        { role: "user", content: "测试模型连接。" },
      ],
      { temperature: 0, maxTokens: 16 },
    );
    return { ok: true, model: model.model, message: "模型连接成功", preview: preview.slice(0, 120) };
  } catch (error) {
    const raw = String(error instanceof Error ? error.message : error).replace(model.api_key || "", "***");
    return { ok: false, model: model.model, message: `模型连接失败：${raw.slice(0, 520)}`, detail: raw.slice(0, 4000) };
  }
}
