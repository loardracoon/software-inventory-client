/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Bind mounts from Windows/OneDrive do not deliver file events into the
// container, so the dev container sets VITE_USE_POLLING=true.
const usePolling = process.env.VITE_USE_POLLING === "true";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
  },
  preview: { host: true, port: 4173, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "supabase/functions/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
