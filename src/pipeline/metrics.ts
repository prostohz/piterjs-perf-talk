import type { Config } from "../config.js";

export const directions = {
  operationTimeMs: -1,
  reactCommits: -1,
  reactRenderTimeMs: -1,
  rafFps: 1,
} as const;

export type Metric = keyof typeof directions;

export interface Statistics {
  samples: number[];
  median: number;
  p95: number;
  min: number;
  max: number;
  spread: number;
}

export type Measurements = Record<string, Partial<Record<Metric, Statistics>>>;
export function summarize(samples: number[]): Statistics {
  if (
    !samples.length ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Invalid metric samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]!
      : sorted[middle - 1]! + (sorted[middle]! - sorted[middle - 1]!) / 2;
  const min = sorted[0]!;
  const max = sorted.at(-1)!;
  return {
    samples: [...samples],
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    min,
    max,
    spread: max - min,
  };
}

export function addMeasurement(
  results: Measurements,
  scenario: string,
  values: Record<string, number>,
  config: Config,
): void {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("Invalid measurement result");
  const metric = config.targetMetric;
  if (!Object.hasOwn(values, metric))
    throw new Error(`Missing metric: ${metric}`);
  if (Object.keys(values).length !== 1)
    throw new Error(`Measure only targetMetric: ${metric}`);
  const value = values[metric]!;
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (metric === "reactCommits" && !Number.isInteger(value))
  )
    throw new Error(`Invalid metric: ${metric}`);
  const metrics =
    results[scenario] ?? (Object.create(null) as Measurements[string]);
  metrics[metric] = summarize([...(metrics[metric]?.samples ?? []), value]);
  results[scenario] = metrics;
}

function median(
  measurements: Measurements,
  scenario: string,
  config: Config,
): number {
  const metrics = measurements[scenario];
  const stats = metrics?.[config.targetMetric];
  if (!stats || stats.samples.length !== config.measurements.repeats)
    throw new Error(
      `Incomplete measurements: ${scenario}/${config.targetMetric}`,
    );
  if (Object.keys(metrics!).length !== 1)
    throw new Error(`Measure only targetMetric: ${config.targetMetric}`);
  if (!Number.isFinite(stats.median) || stats.median < 0)
    throw new Error(`Invalid median: ${scenario}/${config.targetMetric}`);
  return stats.median;
}

export function calculateCost(
  baseline: Measurements,
  candidate: Measurements,
  scenarios: string[],
  config: Config,
): number | null {
  if (!scenarios.length) throw new Error("Cost requires scenarios");
  let cost = 0;
  let count = 0;
  for (const scenario of scenarios) {
    const base = median(baseline, scenario, config);
    if (base <= 0)
      throw new Error(
        `Baseline median must be positive: ${scenario}/${config.targetMetric}`,
      );
    const value = median(candidate, scenario, config);
    const ratio =
      directions[config.targetMetric] === -1 ? value / base : base / value;
    cost += (ratio - cost) / ++count;
  }
  return Number.isFinite(cost) ? cost : null;
}

export function compare(
  baseline: Measurements,
  reference: Measurements,
  candidate: Measurements,
  scenarios: string[],
  config: Config,
): {
  accepted: boolean;
  reasons: string[];
  candidateCost: number | null;
  referenceCost: number;
  improvementPercent: number | null;
} {
  const referenceCost = calculateCost(baseline, reference, scenarios, config);
  if (referenceCost === null) throw new Error("Invalid reference cost");
  const candidateCost = calculateCost(baseline, candidate, scenarios, config);
  const improvementPercent =
    candidateCost === null || referenceCost === 0
      ? null
      : 100 * ((referenceCost - candidateCost) / referenceCost);
  const reasons: string[] = [];
  if (candidateCost === null) reasons.push("Candidate cost is not finite");
  if (referenceCost === 0)
    reasons.push("Reference cost is zero; further improvement is impossible");
  if (improvementPercent !== null) {
    if (!Number.isFinite(improvementPercent)) {
      reasons.push("Cost improvement is not finite");
    } else {
      const epsilon =
        Number.EPSILON *
        Math.max(
          100,
          Math.abs(improvementPercent),
          config.minImprovementPercent,
        ) *
        8;
      if (
        improvementPercent <= 0 ||
        improvementPercent + epsilon < config.minImprovementPercent
      )
        reasons.push("Cost improvement is below minImprovementPercent");
    }
  }
  const accepted = !reasons.length;
  if (accepted) reasons.push("Cost improvement meets minImprovementPercent");
  return {
    accepted,
    reasons,
    candidateCost,
    referenceCost,
    improvementPercent: Number.isFinite(improvementPercent)
      ? improvementPercent
      : null,
  };
}
