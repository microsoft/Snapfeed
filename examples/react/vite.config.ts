import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "..", "..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@snapfeed/client": path.resolve(
        appRoot,
        "../../packages/client/src/index.ts",
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [repoRoot],
    },
  },
  preview: {
    host: "127.0.0.1",
  },
});
