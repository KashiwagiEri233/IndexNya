import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDatabase, type Database, projectRoot } from "./db.ts";
import { handleApiRequest, type ApiResponse } from "./api.ts";
import { HttpError, isHttpError } from "./errors.ts";

const MAX_BODY = 60 * 1024 * 1024;

export interface RuntimeOptions {
  port?: number;
  host?: string;
  dev?: boolean;
  vite?: any;
  database?: Database;
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

async function readBody(request: IncomingMessage, maxBytes = MAX_BODY): Promise<Buffer> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return Buffer.alloc(0);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, `请求体过大，上限 ${Math.floor(maxBytes / 1024 / 1024)}MB`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function writeJson(response: ServerResponse, apiResponse: ApiResponse): void {
  const body = JSON.stringify(apiResponse.json ?? null);
  response.writeHead(apiResponse.status || 200, { ...corsHeaders(), ...apiResponse.headers, "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function writeText(response: ServerResponse, apiResponse: ApiResponse): void {
  const body = apiResponse.text || "";
  response.writeHead(apiResponse.status || 200, { ...corsHeaders(), ...apiResponse.headers, "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

async function writeStream(response: ServerResponse, apiResponse: ApiResponse): Promise<void> {
  response.writeHead(apiResponse.status || 200, {
    ...corsHeaders(),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...apiResponse.headers,
  });
  if (!apiResponse.stream) { response.end(); return; }
  try {
    for await (const item of apiResponse.stream) {
      if (response.destroyed) break;
      response.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
    }
  } catch (error) {
    if (!response.destroyed) response.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`);
  } finally {
    if (!response.destroyed) response.end();
  }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, requestPath: string, dev: boolean, vite: any): Promise<void> {
  if (dev && vite) {
    await new Promise<void>((resolve, reject) => {
      vite.middlewares(request, response, (error: unknown) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return;
  }
  const root = path.join(projectRoot(), "dist");
  let relative = decodeURIComponent(requestPath.split("?")[0] || "/");
  if (relative === "/") relative = "/index.html";
  const candidate = path.resolve(root, `.${relative}`);
  const safe = candidate === root || candidate.startsWith(`${root}${path.sep}`);
  const file = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, "index.html");
  if (!fs.existsSync(file)) { response.writeHead(404, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" }); response.end("dist 不存在，请先运行 npm run build"); return; }
  const contents = await fsp.readFile(file);
  response.writeHead(200, { ...corsHeaders(), "Content-Type": contentType(file), "Content-Length": String(contents.length) });
  response.end(contents);
}

export function createRuntimeServer(options: RuntimeOptions = {}): { server: http.Server; database: Database } {
  const database = options.database || getDatabase();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith("/api")) {
        const body = await readBody(request);
        const apiResponse = await handleApiRequest({ method: request.method || "GET", pathname: url.pathname, searchParams: url.searchParams, headers: requestHeaders(request), body }, database);
        if (apiResponse.stream) await writeStream(response, apiResponse);
        else if (apiResponse.json !== undefined) writeJson(response, apiResponse);
        else writeText(response, apiResponse);
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") { await serveStatic(request, response, url.pathname, Boolean(options.dev), options.vite); return; }
      response.writeHead(405, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" }); response.end("method not allowed");
    } catch (error) {
      const status = isHttpError(error) ? error.status : 500;
      const message = isHttpError(error) ? error.message : (error instanceof Error ? error.message : String(error));
      if (response.headersSent) { response.end(); return; }
      writeJson(response, { status, headers: JSON_HEADERS, json: { detail: message } });
    }
  });
  return { server, database };
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export async function listenRuntime(options: RuntimeOptions = {}): Promise<http.Server> {
  const { server } = createRuntimeServer(options);
  const port = options.port ?? Number(process.env.PORT || 5173);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  console.log(`Index 学习岛 TS 全栈服务已启动：http://${host}:${port}`);
  console.log(`数据文件：${getDatabase().filename}`);
  return server;
}
