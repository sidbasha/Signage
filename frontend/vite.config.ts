import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.VITE_API_PROXY ?? "http://localhost:5080";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/hubs": { target: api, changeOrigin: true, ws: true },
    },
  },
  build: {
    // `npm run build:api` writes straight into the API's wwwroot so one process serves everything.
    outDir: process.env.OUT_DIR ?? "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
