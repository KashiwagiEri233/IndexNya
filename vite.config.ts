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
  // Development is hosted by src/runtime/dev.ts in the same process.
  // All API requests are served same-origin.
  server: {
    port: 5173,
    strictPort: false,
  },
  appType: "spa",
});
