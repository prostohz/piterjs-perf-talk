import { it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../src/config.js";
import { settings } from "./config.fixture.js";

it("rejects invalid config at the boundary", () => {
  expect(() =>
    validateConfig(settings({ minImprovementPercent: NaN })),
  ).toThrow();
  expect(() =>
    validateConfig(settings({ measurements: { repeats: 0 } })),
  ).toThrow();
  expect(() =>
    validateConfig(
      settings({ budgets: { maxDurationMinutes: 0, maxIterations: 1 } }),
    ),
  ).toThrow();
});

it("rejects invalid configuration when loading config.ts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-config-"));
  try {
    await writeFile(
      join(directory, "config.ts"),
      `export default ${JSON.stringify(settings({ measurements: { repeats: 0 } }))};`,
    );
    await expect(loadConfig(directory)).rejects.toThrow(
      "Expected integer >= 1",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
