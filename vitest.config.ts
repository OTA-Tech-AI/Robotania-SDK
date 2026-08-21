import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Every CLI smoke case starts a fresh Node process. On a WSL-mounted
    // workspace that startup can exceed the ordinary 30s test limit.
    testTimeout: 70_000,
  },
});
