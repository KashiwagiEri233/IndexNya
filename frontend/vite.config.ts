import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        // 资源生成可能耗时较长（LLM + 视频/PPT 异步任务），给足超时
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
});
