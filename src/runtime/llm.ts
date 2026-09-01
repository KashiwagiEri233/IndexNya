import type { ChatMessage, ModelConfig, MultimodalPart, ToolCall } from "./types.ts";

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

export type ModelProtocol = "openai" | "anthropic" | "responses";

export function inferProtocol(model: ModelConfig): ModelProtocol {
  if (model.protocol === "anthropic" || model.protocol === "responses" || model.protocol === "openai") {
    return model.protocol;
  }
  const baseUrl = (model.base_url || "").toLowerCase();
  if (baseUrl.includes("/responses") || baseUrl.endsWith("/responses")) {
    return "responses";
  }
  if (baseUrl.includes("anthropic") || baseUrl.endsWith("/anthropic") || baseUrl.includes("/messages")) {
    return "anthropic";
  }
  return "openai";
}

export function hasUsableModel(model?: ModelConfig | null): model is ModelConfig {
  return Boolean(model?.model?.trim() && model?.base_url?.trim() && model?.api_key?.trim());
}

export function assertUsableModel(model?: ModelConfig | null): asserts model is ModelConfig {
  if (!hasUsableModel(model)) {
    throw new LlmError("未配置可用模型，请先在网页左下角「设置」中添加提供商并选择模型");
  }
}

export function endpointUrlForProtocol(model: ModelConfig, protocol: ModelProtocol): string {
  let url = (model.base_url || "").trim().replace(/\/+$/, "");
  if (protocol === "anthropic") {
    if (/\/messages$/i.test(url)) return url;
    if (/\/anthropic$/i.test(url)) return `${url}/v1/messages`;
    if (/\/v\d+$/i.test(url)) return `${url}/messages`;
    return `${url}/v1/messages`;
  }
  if (protocol === "responses") {
    if (/\/responses$/i.test(url)) return url;
    if (/\/v\d+$/i.test(url)) return `${url}/responses`;
    return `${url}/v1/responses`;
  }
  // openai
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/v\d+$/i.test(url)) return `${url}/chat/completions`;
  return `${url}/chat/completions`;
}

export interface ParsedImage {
  url: string;
  mimeType: string;
  base64Data: string;
  detail?: string;
}

export function parseImageInfo(item: unknown): ParsedImage | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as Record<string, unknown>;

  // Anthropic: { type: "image", source: { type: "base64", media_type, data } }
  if (obj.type === "image" && obj.source && typeof obj.source === "object") {
    const source = obj.source as Record<string, unknown>;
    const mediaType = String(source.media_type || "image/jpeg");
    const data = String(source.data || "");
    return {
      url: `data:${mediaType};base64,${data}`,
      mimeType: mediaType,
      base64Data: data,
    };
  }

  // OpenAI / Responses: { type: "image_url" | "input_image", image_url: ... } or { image_url: ... }
  if (obj.type === "image_url" || obj.type === "input_image" || obj.image_url) {
    let url = "";
    let detail = typeof obj.detail === "string" ? obj.detail : undefined;
    if (typeof obj.image_url === "string") {
      url = obj.image_url;
    } else if (obj.image_url && typeof obj.image_url === "object") {
      const imgObj = obj.image_url as Record<string, unknown>;
      url = String(imgObj.url || "");
      if (typeof imgObj.detail === "string") detail = imgObj.detail;
    }
    if (!url) return undefined;

    let mimeType = "image/jpeg";
    let base64Data = "";
    const match = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }
    return { url, mimeType, base64Data, detail };
  }

  return undefined;
}

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        textParts.push(item);
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if ((obj.type === "text" || obj.type === "input_text" || !obj.type) && typeof obj.text === "string") {
          textParts.push(obj.text);
        }
      }
    }
    return textParts.join("\n");
  }
  return "";
}

export function extractImages(content: unknown): ParsedImage[] {
  if (!Array.isArray(content)) return [];
  const images: ParsedImage[] = [];
  for (const item of content) {
    const img = parseImageInfo(item);
    if (img) images.push(img);
  }
  return images;
}

export function formatCitationsMarkdown(citations: Array<{ url: string; title?: string }>): string {
  if (!citations.length) return "";
  const deduped: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  for (const c of citations) {
    const url = (c.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    deduped.push({ url, title: (c.title || url).trim() });
  }
  if (!deduped.length) return "";
  return `\n\n**参考网络来源与文档：**\n` + deduped.map((c) => `- [${c.title}](${c.url})`).join("\n");
}

function friendlyError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (lower.includes("<!doctype html") || lower.includes("<html") || lower.includes("404 - page not found")) {
    return "接口返回了网页 404，而不是模型 API 响应。请检查 Base URL 与 API 协议设置，确保填写真实 API 端点地址。";
  }
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } | string; message?: string; detail?: string };
    const error = parsed.error;
    detail = typeof error === "string" ? error : error?.message || parsed.message || parsed.detail || body;
  } catch {
    // Keep the raw response when it is not JSON.
  }
  detail = detail.replace(/\s+/g, " ").trim();
  return detail.length > 500 ? `${detail.slice(0, 500)}…` : detail || `HTTP ${status}`;
}

export function buildRequestBodyForProtocol(
  model: ModelConfig,
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  protocol: ModelProtocol,
  stream: boolean,
): Record<string, unknown> {
  const effort = model.reasoning_effort?.trim().toLowerCase();

  if (protocol === "anthropic") {
    const systemParts = messages
      .filter((m) => m.role === "system")
      .map((m) => extractTextContent(m.content))
      .filter(Boolean);
    const system = systemParts.join("\n\n");

    const anthropicMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: m.tool_call_id || "tool_result",
                content: extractTextContent(m.content) || JSON.stringify(m.content),
              },
            ],
          };
        }
        const role = m.role === "assistant" ? "assistant" : "user";
        const images = extractImages(m.content);
        const text = extractTextContent(m.content);

        if (images.length === 0) {
          return { role, content: text };
        }

        const content: unknown[] = [];
        for (const img of images) {
          if (img.base64Data) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType || "image/jpeg",
                data: img.base64Data,
              },
            });
          } else if (img.url) {
            content.push({
              type: "image",
              source: {
                type: "url",
                url: img.url,
              },
            });
          }
        }
        if (text) {
          content.push({ type: "text", text });
        }
        return { role, content };
      });

    const body: Record<string, unknown> = {
      model: model.model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: Math.min(1, Math.max(0, options.temperature ?? 0.7)),
      stream,
    };
    if (system) body.system = system;
    if (options.tools?.length) {
      body.tools = options.tools.map((item) => {
        const tool = item as Record<string, unknown>;
        if (tool.name && tool.input_schema) return tool;
        const fn = (tool.function || tool) as Record<string, unknown>;
        return {
          name: fn.name,
          description: fn.description || "",
          input_schema: fn.parameters || { type: "object", properties: {} },
        };
      });
      if (options.toolChoice) {
        if (typeof options.toolChoice === "string") {
          body.tool_choice = { type: options.toolChoice === "required" ? "any" : options.toolChoice };
        } else {
          body.tool_choice = options.toolChoice;
        }
      }
    }
    return body;
  }

  if (protocol === "responses") {
    const instructionsParts = messages
      .filter((m) => m.role === "system")
      .map((m) => extractTextContent(m.content))
      .filter(Boolean);
    const instructions = instructionsParts.join("\n\n");

    const input = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const role = m.role === "assistant" ? "assistant" : "user";
        const images = extractImages(m.content);
        const text = extractTextContent(m.content);
        const content: unknown[] = [];
        if (text) content.push({ type: "input_text", text });
        for (const img of images) {
          content.push({ type: "input_image", image_url: img.url, ...(img.detail ? { detail: img.detail } : {}) });
        }
        return {
          type: "message",
          role,
          content: content.length === 1 && text && images.length === 0 ? text : content,
        };
      });

    const body: Record<string, unknown> = {
      model: model.model,
      input,
      stream,
      max_output_tokens: options.maxTokens ?? 4096,
    };
    if (instructions) body.instructions = instructions;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const tools: unknown[] = [];
    if (model.enable_web_search) {
      // Responses API standard web search tool (DeepSeek & OpenAI compatible)
      tools.push({ type: "web_search" });
    }
    if (options.tools?.length) {
      for (const item of options.tools) {
        const tool = item as Record<string, unknown>;
        const fn = (tool.function || tool) as Record<string, unknown>;
        tools.push({
          type: "function",
          name: fn.name,
          description: fn.description || "",
          parameters: fn.parameters || { type: "object", properties: {} },
        });
      }
    }
    if (tools.length) body.tools = tools;
    if (options.toolChoice) body.tool_choice = options.toolChoice;
    if (effort && REASONING_LEVELS.has(effort)) {
      body.reasoning = { effort };
    }
    return body;
  }

  // Standard OpenAI Chat Completions
  const openAiMessages = messages.map((m) => {
    const images = extractImages(m.content);
    const text = extractTextContent(m.content);
    if (images.length === 0) {
      return { role: m.role, content: text, name: m.name, tool_call_id: m.tool_call_id, tool_calls: m.tool_calls };
    }
    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const img of images) {
      content.push({ type: "image_url", image_url: { url: img.url, ...(img.detail ? { detail: img.detail } : {}) } });
    }
    return { role: m.role, content, name: m.name, tool_call_id: m.tool_call_id, tool_calls: m.tool_calls };
  });

  const body: Record<string, unknown> = {
    model: model.model,
    messages: openAiMessages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    if (options.toolChoice) body.tool_choice = options.toolChoice;
  }
  if (effort && REASONING_LEVELS.has(effort)) {
    body.reasoning_effort = effort;
    body.extra_body = { reasoning_effort: effort };
  }
  return body;
}

async function fetchCompletion(
  model: ModelConfig,
  body: Record<string, unknown>,
  protocol: ModelProtocol,
  timeoutMs = 120_000,
): Promise<Response> {
  assertUsableModel(model);
  const apiKey = model.api_key || "";
  const url = endpointUrlForProtocol(model, protocol);
  const headers: Record<string, string> = {
    Accept: body.stream ? "text/event-stream" : "application/json",
    "Content-Type": "application/json",
  };
  if (protocol === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers,
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
  const protocol = inferProtocol(model);
  const response = await fetchCompletion(model, buildRequestBodyForProtocol(model, messages, options, protocol, false), protocol);
  const data = await responseJson(response);

  if (protocol === "anthropic") {
    const contentBlocks = Array.isArray(data.content) ? data.content : [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of contentBlocks) {
      const item = block as Record<string, unknown>;
      if (item.type === "text" && typeof item.text === "string") {
        textParts.push(item.text);
      } else if (item.type === "tool_use") {
        toolCalls.push({
          id: item.id ? String(item.id) : undefined,
          name: String(item.name || ""),
          arguments: typeof item.input === "string" ? item.input : JSON.stringify(item.input || {}),
        });
      }
    }
    return { content: textParts.join("\n"), toolCalls };
  }

  if (protocol === "responses") {
    let content = typeof data.output_text === "string" ? data.output_text : "";
    const toolCalls: ToolCall[] = [];
    const citations: Array<{ url: string; title?: string }> = [];

    const outputList = Array.isArray(data.output) ? data.output : [];
    for (const rawItem of outputList) {
      const item = rawItem as Record<string, unknown>;
      if (item.type === "message") {
        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            const b = block as Record<string, unknown>;
            if (typeof b.text === "string") {
              if (!content) content += b.text;
            }
            if (Array.isArray(b.annotations)) {
              for (const ann of b.annotations) {
                const a = ann as Record<string, unknown>;
                if (a.url) citations.push({ url: String(a.url), title: a.title ? String(a.title) : undefined });
              }
            }
          }
        } else if (typeof item.content === "string" && !content) {
          content = item.content;
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id ? String(item.call_id) : undefined,
          name: String(item.name || ""),
          arguments: String(item.arguments || "{}"),
        });
      }
    }
    if (citations.length) {
      content += formatCitationsMarkdown(citations);
    }
    return { content, toolCalls };
  }

  // OpenAI
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
  const protocol = inferProtocol(model);
  const response = await fetchCompletion(model, buildRequestBodyForProtocol(model, messages, options, protocol, true), protocol);
  if (!response.ok) {
    const text = await response.text();
    throw new LlmError(`模型请求失败：${friendlyError(response.status, text)}`, response.status, text);
  }
  if (!response.body) throw new LlmError("模型没有返回可读取的流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolParts = new Map<number, { id?: string; name: string; arguments: string }>();
  const citations: Array<{ url: string; title?: string }> = [];

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

      if (protocol === "anthropic") {
        const eventType = String(parsed.event || data.type || "");
        if (eventType === "content_block_delta" || data.type === "content_block_delta") {
          const delta = (data.delta || {}) as Record<string, unknown>;
          if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
            yield { type: "token", text: delta.text };
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            const index = Number(data.index ?? toolParts.size);
            const part = toolParts.get(index) || { id: undefined, name: "", arguments: "" };
            part.arguments += delta.partial_json;
            toolParts.set(index, part);
          }
        } else if (eventType === "content_block_start" || data.type === "content_block_start") {
          const blockObj = (data.content_block || {}) as Record<string, unknown>;
          if (blockObj.type === "tool_use") {
            const index = Number(data.index ?? toolParts.size);
            const part = toolParts.get(index) || { id: undefined, name: "", arguments: "" };
            if (blockObj.id) part.id = String(blockObj.id);
            if (blockObj.name) part.name = String(blockObj.name);
            toolParts.set(index, part);
          }
        } else if (eventType === "error" || data.type === "error") {
          const err = (data.error || {}) as Record<string, unknown>;
          throw new LlmError(String(err.message || "Anthropic 流式返回错误"));
        }
        continue;
      }

      if (protocol === "responses") {
        const eventType = String(parsed.event || data.type || "");
        if (eventType === "response.output_text.delta" || data.type === "response.output_text.delta") {
          if (typeof data.delta === "string" && data.delta) yield { type: "token", text: data.delta };
        } else if (eventType === "response.text.delta" || data.type === "response.text.delta") {
          if (typeof data.delta === "string" && data.delta) yield { type: "token", text: data.delta };
        } else if (eventType === "response.content_part.delta" || data.type === "response.content_part.delta") {
          const delta = (data.delta || {}) as Record<string, unknown>;
          if (typeof delta.text === "string" && delta.text) yield { type: "token", text: delta.text };
        } else if (eventType === "response.text.done" || data.type === "response.text.done") {
          const annList = Array.isArray(data.annotations) ? data.annotations : [];
          for (const ann of annList) {
            const a = ann as Record<string, unknown>;
            if (a.url) citations.push({ url: String(a.url), title: a.title ? String(a.title) : undefined });
          }
        } else if (eventType === "response.function_call_arguments.delta" || data.type === "response.function_call_arguments.delta") {
          const index = Number(data.output_index ?? 0);
          const part = toolParts.get(index) || { id: data.call_id ? String(data.call_id) : undefined, name: "", arguments: "" };
          if (typeof data.delta === "string") part.arguments += data.delta;
          toolParts.set(index, part);
        } else if (eventType === "response.output_item.added" || data.type === "response.output_item.added") {
          const item = (data.item || {}) as Record<string, unknown>;
          if (item.type === "function_call") {
            const index = Number(data.output_index ?? toolParts.size);
            const part = toolParts.get(index) || { id: item.call_id ? String(item.call_id) : undefined, name: String(item.name || ""), arguments: "" };
            if (item.name) part.name = String(item.name);
            if (item.call_id) part.id = String(item.call_id);
            toolParts.set(index, part);
          }
        } else if (eventType === "error" || data.type === "error") {
          const err = (data.error || {}) as Record<string, unknown>;
          throw new LlmError(String(err.message || "Responses API 流式返回错误"));
        }
        continue;
      }

      // OpenAI
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

  if (citations.length) {
    const citationDoc = formatCitationsMarkdown(citations);
    if (citationDoc) yield { type: "token", text: citationDoc };
  }

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
    const protocol = inferProtocol(model);
    const preview = await chatCompleteText(
      model,
      [
        { role: "system", content: "请只回复：连接成功" },
        { role: "user", content: "测试模型连接。" },
      ],
      { temperature: 0, maxTokens: 16 },
    );
    return {
      ok: true,
      model: model.model,
      message: `模型连接成功 [${protocol.toUpperCase()}]`,
      preview: preview.slice(0, 120),
    };
  } catch (error) {
    const raw = String(error instanceof Error ? error.message : error).replace(model.api_key || "", "***");
    return { ok: false, model: model.model, message: `模型连接失败：${raw.slice(0, 520)}`, detail: raw.slice(0, 4000) };
  }
}
