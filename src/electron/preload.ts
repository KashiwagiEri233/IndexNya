import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI, ElectronThemePayload } from "./types.ts";

const electronAPI: ElectronAPI = {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  updateTheme: (payload: ElectronThemePayload) => ipcRenderer.invoke("update-theme", payload),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
