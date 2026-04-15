import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Mirrors defaults in src/cli/daemon-common.ts. Kept inline so vite.config has
// no runtime dep on the CLI module graph. The Bun reverse-proxy in
// src/server/index.ts targets the same FLUX_VITE_PORT.
const FLUX_VITE_PORT = Number(process.env.FLUX_VITE_PORT) || 8043;
const fluxBackend = `http://localhost:${process.env.FLUX_PORT ?? "8042"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      $convex: path.resolve(__dirname, "convex"),
    },
  },
  server: {
    port: FLUX_VITE_PORT,
    strictPort: true,
    hmr: {
      port: FLUX_VITE_PORT,
    },
    proxy: {
      "/api": fluxBackend,
      "/health": fluxBackend,
      "/p": fluxBackend,
      "/sse": fluxBackend,
    },
  },
});
