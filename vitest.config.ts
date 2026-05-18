import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000, // subprocess CLI smoke runs can exceed Vitest defaults (esp. CI / networked drives)
  },
});
