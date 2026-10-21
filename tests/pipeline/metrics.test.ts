import { describe, expect, it } from "vitest";
import {
  addMeasurement,
  calculateCost,
  compare,
  summarize,
} from "../../src/pipeline/metrics.js";
import type { Measurements, Metric } from "../../src/pipeline/metrics.js";
import { settings } from "../config.fixture.js";

function measurements(
  values: number[],
  metric: Metric = "operationTimeMs",
): Measurements {
  return Object.fromEntries(
    values.map((value, index) => [
      String(index),
      { [metric]: summarize([value, value, value]) },
    ]),
  );
}

function decision(
  base: number[],
  reference: number[],
  candidate: number[],
  overrides: Parameters<typeof settings>[0] = {},
) {
  const config = settings(overrides);
  return compare(
    measurements(base, config.targetMetric),
    measurements(reference, config.targetMetric),
    measurements(candidate, config.targetMetric),
    base.map((_, index) => String(index)),
    config,
  );
}

describe("statistics and cost", () => {
  it("preserves samples and uses nearest-rank p95 and max-minus-min spread", () => {
    expect(summarize([9, 1, 4, 2])).toEqual({
      samples: [9, 1, 4, 2],
      median: 3,
      p95: 9,
      min: 1,
      max: 9,
      spread: 8,
    });
    expect(summarize([Number.MAX_VALUE, Number.MAX_VALUE]).median).toBe(
      Number.MAX_VALUE,
    );
    expect(summarize([Number.MIN_VALUE, Number.MIN_VALUE]).median).toBe(
      Number.MIN_VALUE,
    );
  });
  it.each([[], [NaN], [Infinity], [-1]].map((values) => ({ values })))(
    "rejects invalid samples $values",
    ({ values }) => expect(() => summarize(values)).toThrow(),
  );
  it.each([
    [99, true],
    [99.01, false],
    [100.5, false],
    [0, true],
  ])("compares baseline 100 with %s", (after, accepted) => {
    expect(decision([100], [100], [after]).accepted).toBe(accepted);
  });
  it("normalizes all scenarios against the original baseline with equal weights", () => {
    const result = decision([100, 1000], [50, 900], [60, 700]);
    expect(result.accepted).toBe(true);
    expect(result.referenceCost).toBeCloseTo(0.7);
    expect(result.candidateCost).toBeCloseTo(0.65);
    expect(result.improvementPercent).toBeCloseTo(100 / 14);
  });
  it("does not accept a single improved scenario when total cost regresses", () => {
    expect(decision([100, 100], [100, 100], [50, 160]).accepted).toBe(false);
  });
  it("accepts the Fuse iteration 7 tradeoff over iteration 3", () => {
    const result = decision(
      [17.1, 114.9, 107.4, 44, 8.5, 109.4],
      [13, 61.7, 54.5, 29.1, 7.4, 56.8],
      [8.2, 34.5, 27.1, 29.4, 7.8, 28.6],
    );
    expect(result.accepted).toBe(true);
    expect(result.referenceCost).toBeCloseTo(0.64263648);
    expect(result.candidateCost).toBeCloseTo(0.47989597);
    expect(result.improvementPercent).toBeCloseTo(25.32388);
  });
  it("keeps baseline cost exactly one across six scenarios", () => {
    expect(
      decision([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6])
        .referenceCost,
    ).toBe(1);
  });
  it.each([
    [0.1, 99.9, true],
    [0.1, 99.91, false],
    [0.5, 99.5, true],
    [1, 99, true],
    [1, 99.01, false],
    [5, 95, true],
    [5, 95.01, false],
  ])(
    "applies only the configured %s percent threshold to %s",
    (minimum, value, accepted) => {
      expect(
        decision([100], [100], [value], { minImprovementPercent: minimum })
          .accepted,
      ).toBe(accepted);
    },
  );
  it("never accepts unchanged or worse cost even with a tiny positive threshold", () => {
    for (const value of [100, 100.00000000000001])
      expect(
        decision([100], [100], [value], {
          minImprovementPercent: Number.MIN_VALUE,
        }).accepted,
      ).toBe(false);
  });
  it("rejects a regression when its percentage overflows", () => {
    expect(decision([1], [Number.MIN_VALUE], [1])).toMatchObject({
      accepted: false,
      candidateCost: 1,
      referenceCost: Number.MIN_VALUE,
      improvementPercent: null,
    });
  });
  it("inverts higher-is-better metrics before averaging", () => {
    const result = decision([60, 30], [60, 30], [120, 20], {
      targetMetric: "rafFps",
    });
    expect(result.candidateCost).toBe(1);
    expect(result.accepted).toBe(false);
    expect(
      decision([60], [60], [120], { targetMetric: "rafFps" }),
    ).toMatchObject({
      accepted: true,
      candidateCost: 0.5,
      improvementPercent: 50,
    });
  });
  it.each<Metric>([
    "operationTimeMs",
    "rafFps",
    "reactCommits",
    "reactRenderTimeMs",
  ])("rejects zero baseline for %s", (targetMetric) => {
    expect(() => decision([0], [0], [10], { targetMetric })).toThrow(
      "Baseline median must be positive",
    );
  });
  it("rejects undefined or infinite candidate cost, without serializing Infinity", () => {
    for (const result of [
      decision([60], [60], [0], { targetMetric: "rafFps" }),
      decision([Number.MIN_VALUE], [Number.MIN_VALUE], [Number.MAX_VALUE]),
    ]) {
      expect(result).toMatchObject({
        accepted: false,
        candidateCost: null,
        improvementPercent: null,
      });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });
  it("does not improve further from zero reference cost", () => {
    for (const value of [0, 1])
      expect(decision([100], [0], [value])).toMatchObject({
        accepted: false,
        referenceCost: 0,
        improvementPercent: null,
      });
  });
  it("rejects incomplete series or missing scenarios", () => {
    expect(() =>
      decision([100], [100], [90], { measurements: { repeats: 5 } }),
    ).toThrow("Incomplete");
    expect(() => decision([100, 100], [100, 100], [90])).toThrow("Incomplete");
    expect(() => calculateCost({}, {}, [], settings())).toThrow(
      "requires scenarios",
    );
  });
  it("stores only targetMetric and rejects extra or invalid metrics", () => {
    const results: Measurements = {};
    const config = settings();
    expect(() => addMeasurement(results, "s", {}, config)).toThrow("Missing");
    for (const value of [NaN, Infinity, -1])
      expect(() =>
        addMeasurement(results, "s", { operationTimeMs: value }, config),
      ).toThrow("Invalid");
    expect(() =>
      addMeasurement(
        results,
        "s",
        { operationTimeMs: 1, reactCommits: 0 },
        config,
      ),
    ).toThrow("only targetMetric");
    expect(() =>
      addMeasurement(
        results,
        "s",
        { reactCommits: 0.5 },
        settings({ targetMetric: "reactCommits" }),
      ),
    ).toThrow("Invalid");
    addMeasurement(results, "s", { operationTimeMs: 1 }, config);
    addMeasurement(results, "s", { operationTimeMs: 2 }, config);
    expect(Object.keys(results.s!)).toEqual(["operationTimeMs"]);
    expect(results.s!.operationTimeMs!.samples).toEqual([1, 2]);
  });
});
