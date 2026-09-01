import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { useAppStore } from "./stores/app";
import { applyTheme } from "./lib/theme";
import "./styles/globals.css";

if (typeof window !== "undefined" && window.electronAPI?.isElectron && window.electronAPI?.platform === "darwin") {
  document.documentElement.classList.add("is-mac-desktop");
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// 渲染前先应用外观主题，避免闪烁（zustand persist 对 localStorage 同步水合）
{
  const { themeMode, accentColor } = useAppStore.getState();
  applyTheme(themeMode, accentColor);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
