import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Coverage instrumentation slows the engine down about fourfold; speed
    // checks allow for it, and so does the time limit of every test.
    env: { PERF_FACTOR: process.argv.includes("--coverage") ? "4" : "1" },
    testTimeout: process.argv.includes("--coverage") ? 20_000 : 5_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/lib/**/*.ts", "netlify/lib/**/*.ts"],
      // Browser-only (canvas, Web Worker) or platform wiring: covered by the
      // Playwright walkthrough and the netlify dev run instead.
      exclude: ["src/lib/image.ts", "src/lib/useAnalysis.ts", "src/lib/analysis.worker.ts", "netlify/lib/netlify-deps.ts"],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
