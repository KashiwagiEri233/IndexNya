/// <reference types="vite/client" />

interface ElectronThemePayload {
  mode: "light" | "dark";
  backgroundColor: string;
  symbolColor: string;
  accentColor: string;
}

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  updateTheme: (payload: ElectronThemePayload) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
