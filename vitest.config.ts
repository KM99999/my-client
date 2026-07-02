import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests are pure and hermetic. Integration tests (added in M1.2) live
    // under tests/integration and require a running Postgres.
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
