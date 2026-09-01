import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types.ts";

const electronAPI: ElectronAPI = {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
