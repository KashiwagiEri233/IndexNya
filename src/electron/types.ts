export interface ElectronThemePayload {
  mode: "light" | "dark";
  backgroundColor: string;
  symbolColor: string;
  accentColor: string;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  updateTheme: (payload: ElectronThemePayload) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
