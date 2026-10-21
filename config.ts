import type { Config } from "./src/config.js";

export default {
  agent: {
    provider: "codex",
    model: "gpt-6.1-sol",
    reasoningEffort: "medium",
  },
  targetMetric: "operationTimeMs",
  measurements: { repeats: 30 },
  budgets: { maxDurationMinutes: 240, maxIterations: 40 },
  minImprovementPercent: 1,
} satisfies Config;
