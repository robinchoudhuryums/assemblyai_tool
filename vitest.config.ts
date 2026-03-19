import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  // Vitest 4 uses rolldown/oxc which needs explicit JSX handling
  oxc: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./client/src/test-setup.ts"],
    include: ["client/src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
