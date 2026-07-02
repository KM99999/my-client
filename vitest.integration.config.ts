import { defineConfig } from "vitest/config";

// Integration tests hit a real Postgres (see docs/README.md). They are
// intentionally single-file, single-thread and sequential so concurrency
// assertions are deterministic and tests don't clobber each other's data.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
