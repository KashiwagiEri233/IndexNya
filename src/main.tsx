import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { useAppStore } from "./stores/app";
import { applyTheme } from "./lib/theme";
import "./styles/globals.css";

if (typeof window !== "undefined" && window.electronAPI?.isElectron) {
  const platform = window.electronAPI.platform;
  if (platform === "darwin") {
    document.documentElement.classList.add("is-mac-desktop");
  } else if (platform === "win32") {
    document.documentElement.classList.add("is-win-desktop");
  }
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

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
