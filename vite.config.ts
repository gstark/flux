import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      $convex: path.resolve(__dirname, "convex"),
    },
  },
  server: {
    port: 8043,
    strictPort: true,
    hmr: {
      port: 8043,
    },
  },
});
