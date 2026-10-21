import {
  directions,
  type Metric,
  type Statistics,
} from "../pipeline/metrics.js";
import type { Attempt, Report } from "../pipeline/report.js";

export interface RunSummary {
  target: string;
  id: string;
  startedAt?: string;
  status?: Report["status"];
  attempts?: number;
  accepted?: number;
  error?: string;
}

export interface Catalog {
  runs: RunSummary[];
}

export interface RunDetail {
  report: Report;
  events: string;
}

export interface AttemptDiff {
  parent: string | null;
  patch: string;
}

export function diffLineCounts(patch: string) {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) inHunk = false;
    else if (line.startsWith("@@ ")) inHunk = true;
    else if (inHunk && line.startsWith("+")) added++;
    else if (inHunk && line.startsWith("-")) removed++;
  }
  return { added, removed };
}

export function workingDurationMs(report: Report, now = Date.now()): number {
  const periods = report.periods ?? [
    { startedAt: report.startedAt, finishedAt: report.finishedAt },
  ];
  return periods.reduce(
    (total, period) =>
      total +
      Math.max(
        0,
        (period.finishedAt ? Date.parse(period.finishedAt) : now) -
          Date.parse(period.startedAt),
      ),
    0,
  );
}

export function scenarios(report: Report): string[] {
  return [
    ...new Set(report.attempts.flatMap((a) => Object.keys(a.measurements))),
  ];
}

export function improvement(
  before: number,
  after: number,
  metric: Metric,
): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return ((after - before) / before) * directions[metric] * 100;
}

export function complete(
  stats: Statistics | undefined,
  report: Report,
): boolean {
  return (
    stats !== undefined &&
    stats.samples.length === report.config.measurements.repeats
  );
}

export function reference(
  report: Report,
  attempt: Attempt,
): Attempt | undefined {
  return report.attempts.find((a) => a.id === attempt.parent);
}
