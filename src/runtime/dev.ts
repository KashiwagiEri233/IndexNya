import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntimeServer } from "./runtime.ts";
import { projectRoot } from "./db.ts";

const frontendRoot = projectRoot();
const runtimeOptions: { dev: boolean; vite?: any } = { dev: true };
const { server } = createRuntimeServer(runtimeOptions);
let vite: any;
try {
  const vitePath = path.join(frontendRoot, "node_modules", "vite", "dist", "node", "index.js");
  const module = await import(pathToFileURL(vitePath).href);
  // Reuse the same HTTP server for HMR. The old architecture needed a
  // second process and a second port; this keeps development single-process.
  vite = await module.createServer({ root: frontendRoot, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
  runtimeOptions.vite = vite;
} catch (error) {
  runtimeOptions.dev = false;
  console.warn(`Vite 中间件加载失败，将只启动 API：${error instanceof Error ? error.message : String(error)}`);
}

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
console.log(`Index 学习岛 TS 全栈开发服务已启动：http://${host}:${port}`);
