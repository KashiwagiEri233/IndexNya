import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function findAvailablePort(startPort, host = "127.0.0.1") {
  for (let p = startPort; p < startPort + 50; p++) {
    const isFree = await new Promise((resolve) => {
      const tester = net.createServer()
        .once("error", () => resolve(false))
        .once("listening", () => {
          tester.close(() => resolve(true));
        })
        .listen(p, host);
    });
    if (isFree) return p;
  }
  return startPort;
}

const requestedPort = Number(process.env.PORT || 5173);
const devPort = await findAvailablePort(requestedPort);
const devUrl = `http://127.0.0.1:${devPort}`;

console.log("正在编译 Electron 主进程与 Preload 脚本...");
const buildScript = path.join(root, "scripts", "build-electron.mjs");
await import(pathToFileURL(buildScript).href);

console.log(`正在启动全栈开发服务 (${devUrl})...`);
const devServer = spawn(process.execPath, ["--experimental-strip-types", "src/runtime/dev.ts"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(devPort) },
});

devServer.stdout.on("data", (data) => {
  process.stdout.write(`[Server] ${data}`);
});

devServer.stderr.on("data", (data) => {
  process.stderr.write(`[Server] ${data}`);
});

let isExiting = false;
function cleanup() {
  if (isExiting) return;
  isExiting = true;
  try {
    if (devServer && !devServer.killed) {
      devServer.kill("SIGTERM");
    }
  } catch {}
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", cleanup);

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

const ready = await waitForServer(devUrl);
if (!ready) {
  console.error("开发服务启动超时，无法拉起 Electron 窗口。");
  cleanup();
  process.exit(1);
}

console.log("开发服务已就绪，正在启动 Electron 桌面窗口...");
const electronBinary = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

const electronProcess = spawn(electronBinary, ["dist-electron/main.cjs"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    INDEXNYA_DEV_URL: devUrl,
  },
});

electronProcess.on("close", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
