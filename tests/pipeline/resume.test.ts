import { expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setup, execute } from "./run.fixture.js";
import { beginResume, resumePeriod } from "../../src/runtime/resume.js";
import type { CodingAgent } from "../../src/agents/types.js";

it("extends ten iterations to twenty in the same history without repeating baseline", async () => {
  const f = await setup();
  f.report.config.budgets.maxIterations = 10;
  f.report.periods![0]!.budgets.maxIterations = 10;
  let baselines = 0;
  const prepare = f.target.prepare;
  f.target.prepare = async (path) => {
    if (path.endsWith("baseline/library")) baselines++;
    return prepare(path);
  };
  const prompts: string[] = [];
  const agent: Pick<CodingAgent, "run"> = {
    async run({ cwd, prompt, tools }) {
      prompts.push(prompt);
      await writeFile(join(cwd, "index.ts"), "export const value = 80;\n");
      expect(await tools[0]!.execute({})).toMatchObject({ success: true });
      return { hypothesis: "Reduce work" };
    },
  };
  await execute(f, agent);
  expect(f.report.status, f.report.stopReason).toBe("completed");
  const previous = structuredClone(f.report);
  beginResume(
    f.report,
    resumePeriod(
      f.report,
      { maxDurationMinutes: 1, maxIterations: 10 },
      new Date(),
      {},
    ),
  );
  await execute(f, agent);
  expect(f.report.status, f.report.stopReason).toBe("completed");
  expect(baselines).toBe(1);
  expect(f.report.attempts).toHaveLength(21);
  expect(f.report.attempts.slice(0, 11)).toEqual(previous.attempts);
  expect(f.report.attempts.at(-1)!.id).toBe("iteration-020");
  expect(f.report.attempts[11]!.parent).toBe("iteration-001");
  expect(prompts[10]).toContain('"id":"iteration-010"');
  expect(f.report.periods).toHaveLength(2);
});

it("keeps original baseline normalization when a resumed candidate trades off scenarios", async () => {
  const f = await setup();
  f.report.config.budgets.maxIterations = 1;
  const prepare = f.target.prepare;
  f.target.prepare = async (path) => {
    const session = await prepare(path);
    return {
      ...session,
      async measure(scenario, metric) {
        expect(metric).toBe("operationTimeMs");
        const { operationTimeMs: value } = await session.measure(
          scenario,
          metric,
        );
        return {
          operationTimeMs:
            scenario === "one"
              ? value!
              : value === 100
                ? 1000
                : value === 50
                  ? 900
                  : 700,
        };
      },
    };
  };
  let value = 50;
  const agent: Pick<CodingAgent, "run"> = {
    async run({ cwd, tools }) {
      await writeFile(join(cwd, "index.ts"), `export const value = ${value};`);
      expect(await tools[0]!.execute({})).toMatchObject({ success: true });
      return { hypothesis: "Trade off two scenarios" };
    },
  };
  await execute(f, agent);
  expect(f.report.status, f.report.stopReason).toBe("completed");
  expect(f.report.attempts[1]!.cost).toBeCloseTo(0.7);
  const baseline = structuredClone(f.report.attempts[0]);
  value = 60;
  beginResume(
    f.report,
    resumePeriod(
      f.report,
      { maxDurationMinutes: 1, maxIterations: 1 },
      new Date(),
      {},
    ),
  );
  await execute(f, agent);
  expect(f.report.status, f.report.stopReason).toBe("completed");
  expect(f.report.best).toBe("iteration-002");
  expect(f.report.attempts[0]).toEqual(baseline);
  expect(f.report.attempts[2]!.cost).toBeCloseTo(0.65);
  expect(f.report.attempts[2]!.decision!.referenceCost).toBeCloseTo(0.7);
  expect(f.report.attempts[2]!.decision!.improvementPercent).toBeCloseTo(
    100 / 14,
  );
});
