import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; it's a no-op for tests.
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    env: { DATABASE_URL: "pglite:memory", SESSION_SECRET: "test-secret-test-secret-test-secret!!", APP_URL: "https://forms.example.com" },
    testTimeout: 30_000,
  },
});
