import { describe, expect, it } from "vitest";
import { setup, execute } from "./run.fixture.js";

describe("evaluate", () => {
  it("stops immediately on a measurement failure and keeps partial results", async () => {
    const f = await setup();
    const prepare = f.target.prepare;
    let calls = 0;
    let closed = false;
    f.target.prepare = async (path) => {
      const session = await prepare(path);
      return {
        ...session,
        async measure() {
          if (++calls === 2) throw new Error("Wrong DOM");
          return { operationTimeMs: 100 };
        },
        async close() {
          closed = true;
        },
      };
    };
    let edits = 0;
    await execute(f, {
      async run() {
        edits++;
        return { hypothesis: "never" };
      },
    });
    expect(f.report.status).toBe("failed");
    expect(edits).toBe(0);
    expect(closed).toBe(true);
    expect(
      f.report.attempts[0]!.measurements.one!.operationTimeMs!.samples,
    ).toEqual([100]);
    expect(f.report.stopReason).toContain("Wrong DOM");
  });
});

it("does not restart the agent after a candidate measurement fails", async () => {
  const f = await setup();
  const prepare = f.target.prepare;
  let prepared = 0;
  let agents = 0;
  f.target.prepare = async (path) => {
    const number = ++prepared;
    const session = await prepare(path);
    return {
      ...session,
      async measure(scenario, metric) {
        if (number > 1) throw new Error("Measurement failed");
        return session.measure(scenario, metric);
      },
    };
  };
  await execute(f, {
    async run({ tools }) {
      agents++;
      await tools[0]!.execute({});
      return { hypothesis: "Reduce work" };
    },
  });
  expect(agents).toBe(1);
  expect(f.report.status).toBe("failed");
  expect(f.report.stopReason).toContain("Measurement failed");
  expect(f.report.best).toBe("baseline");
});

it.each(["zero baseline", "extra metric"])(
  "stops before hypotheses for %s",
  async (failure) => {
    const f = await setup();
    const prepare = f.target.prepare;
    f.target.prepare = async (path) => ({
      ...(await prepare(path)),
      async measure(): Promise<Record<string, number>> {
        return failure === "zero baseline"
          ? { operationTimeMs: 0 }
          : { operationTimeMs: 100, reactCommits: 0 };
      },
    });
    await execute(f, {
      async run() {
        throw new Error("Agent must not run");
      },
    });
    expect(f.report.status).toBe("failed");
    expect(f.report.stopReason).toContain(
      failure === "zero baseline"
        ? "Baseline median must be positive"
        : "only targetMetric",
    );
    expect(f.report.best).toBeNull();
    expect(f.report.attempts).toHaveLength(1);
  },
);

it("passes the selected metric to the target and rejects infinite cost without stopping", async () => {
  const f = await setup();
  f.report.config.targetMetric = "rafFps";
  f.report.config.budgets.maxIterations = 1;
  const prepare = f.target.prepare;
  f.target.prepare = async (path) => ({
    ...(await prepare(path)),
    async measure(_scenario, metric) {
      expect(metric).toBe("rafFps");
      return { [metric]: path.includes("baseline/library") ? 60 : 0 };
    },
  });
  await execute(f, {
    async run({ tools, prompt }) {
      expect(prompt).toContain('"targetMetric":"rafFps"');
      expect(prompt).not.toContain("constraintMetrics");
      expect(await tools[0]!.execute({})).toMatchObject({ success: true });
      return { hypothesis: "Test FPS" };
    },
  });
  expect(f.report.status, f.report.stopReason).toBe("completed");
  expect(f.report.attempts[0]!.cost).toBe(1);
  expect(f.report.attempts[1]).toMatchObject({
    status: "rejected",
    cost: null,
    decision: { referenceCost: 1, improvementPercent: null },
  });
  expect(Object.keys(f.report.attempts[1]!.measurements.one!)).toEqual([
    "rafFps",
  ]);
  expect(f.report.best).toBe("baseline");
});
