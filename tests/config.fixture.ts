import config from "../config.js";
import type { Config } from "../src/config.js";

export function settings(overrides: Partial<Config> = {}): Config {
  return {
    ...structuredClone(config),
    measurements: { repeats: 3 },
    budgets: { maxDurationMinutes: 1, maxIterations: 3 },
    ...overrides,
  };
}
