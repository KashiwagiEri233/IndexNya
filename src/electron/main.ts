import { app, BrowserWindow, shell, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";
import { listenRuntime } from "../runtime/runtime.ts";
import { projectRoot } from "../runtime/db.ts";

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let serverInstance: Server | null = null;
let appUrl = "";

function setupDesktopEnvironment(): void {
  if (app.isPackaged) {
    const userData = app.getPath("userData");
    process.env.INDEXNYA_DATA_DIR ??= userData;

    const appPath = app.getAppPath();
    const possibleStaticDirs = [
      path.join(appPath, "dist"),
      path.join(process.resourcesPath, "dist"),
      path.join(__dirname, "..", "dist"),
    ];
    const staticDir = possibleStaticDirs.find((d) => fs.existsSync(d) && fs.existsSync(path.join(d, "index.html")));
    if (staticDir) {
      process.env.INDEXNYA_STATIC_DIR = staticDir;
    }

    const possibleSeedDirs = [
      path.join(process.resourcesPath, "skills"),
      path.join(appPath, "src", "runtime", "skills"),
      path.join(__dirname, "..", "src", "runtime", "skills"),
    ];
    const seedDir = possibleSeedDirs.find((d) => fs.existsSync(d));
    if (seedDir) {
      process.env.INDEXNYA_SKILLS_SEED_DIR = seedDir;
    }
  }
}

async function startServer(): Promise<string> {
  const devUrl = process.env.INDEXNYA_DEV_URL?.trim();
  if (devUrl) {
    return devUrl;
  }

  setupDesktopEnvironment();
  serverInstance = await listenRuntime({
    dev: false,
    port: 0,
    host: "127.0.0.1",
  });

  const address = serverInstance.address();
  const port = typeof address === "object" && address ? address.port : 5173;
  return `http://127.0.0.1:${port}`;
}

function createWindow(url: string): void {
  const appPath = app.isPackaged ? app.getAppPath() : projectRoot();
  const iconCandidates = [
    path.join(__dirname, "..", "public", "favicon.svg"),
    path.join(process.resourcesPath, "public", "favicon.svg"),
    path.join(appPath, "public", "favicon.svg"),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Index 学习岛",
    show: false,
    backgroundColor: "#f8f8f0",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    titleBarOverlay: !isMac
      ? {
          color: "#f8f8f0",
          symbolColor: "#794f27",
          height: 38,
        }
      : false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: iconPath,
  });

  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith("http:") || targetUrl.startsWith("https:")) {
      shell.openExternal(targetUrl);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      const currentOrigin = new URL(url).origin;
      const nextOrigin = new URL(targetUrl).origin;
      if (currentOrigin !== nextOrigin && (targetUrl.startsWith("http:") || targetUrl.startsWith("https:"))) {
        event.preventDefault();
        shell.openExternal(targetUrl);
      }
    } catch {}
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("open-external", async (_, targetUrl: unknown) => {
  if (typeof targetUrl === "string" && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
    await shell.openExternal(targetUrl);
  }
});
ipcMain.handle("update-theme", (_, payload: unknown) => {
  if (!mainWindow || typeof payload !== "object" || !payload) return;
  const { backgroundColor, symbolColor } = payload as {
    backgroundColor?: string;
    symbolColor?: string;
    mode?: "light" | "dark";
    accentColor?: string;
  };
  if (backgroundColor) {
    try {
      mainWindow.setBackgroundColor(backgroundColor);
    } catch {}
  }
  if (process.platform !== "darwin" && typeof (mainWindow as any).setTitleBarOverlay === "function" && backgroundColor && symbolColor) {
    try {
      (mainWindow as any).setTitleBarOverlay({
        color: backgroundColor,
        symbolColor: symbolColor,
        height: 38,
      });
    } catch {}
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    appUrl = await startServer();
    createWindow(appUrl);
  } catch (error) {
    console.error("启动失败:", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
    createWindow(appUrl);
  }
});

app.on("before-quit", () => {
  if (serverInstance) {
    try {
      serverInstance.close();
    } catch {}
  }
});
