import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Minimal Vitest setup: Node environment, tests live next to the code in
// __tests__ folders, and the "@/..." import alias matches tsconfig.json.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
