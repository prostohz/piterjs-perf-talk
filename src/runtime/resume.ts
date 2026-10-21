import { isDeepStrictEqual } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { validateConfig, type Config } from "../config.js";
import { calculateCost } from "../pipeline/metrics.js";
import type { Report, RunPeriod } from "../pipeline/report.js";

export function validateExtension(budgets: Config["budgets"]): void {
  if (
    !Number.isFinite(budgets.maxDurationMinutes) ||
    budgets.maxDurationMinutes <= 0 ||
    !Number.isFinite(budgets.maxDurationMinutes * 60_000) ||
    !Number.isSafeInteger(budgets.maxIterations) ||
    budgets.maxIterations <= 0
  )
    throw new Error(
      "Resume requires positive minutes and a positive integer iteration count",
    );
}

export function resumePeriod(
  report: Report,
  budgets: Config["budgets"],
  startedAt: Date,
  environment: Record<string, unknown>,
): RunPeriod {
  validateExtension(budgets);
  validateConfig(report.config);
  if (!["completed", "interrupted", "failed"].includes(report.status))
    throw new Error("Only a stopped run can be resumed");
  if (!report.finishedAt || !Number.isFinite(Date.parse(report.finishedAt)))
    throw new Error("Run has no recorded finish time");
  const baseline = report.attempts[0];
  if (
    baseline?.id !== "baseline" ||
    baseline.status !== "accepted" ||
    baseline.parent !== null
  )
    throw new Error("Resume requires a completed baseline");
  const accepted = report.attempts.filter(
    (attempt) => attempt.status === "accepted",
  );
  if (accepted.at(-1)?.id !== report.best)
    throw new Error("Invalid accepted reference");
  const ids = new Set<string>(["baseline"]);
  let last = 0;
  for (const attempt of report.attempts.slice(1)) {
    const match = /^iteration-(\d+)$/.exec(attempt.id);
    const index = match ? Number(match[1]) : NaN;
    if (
      !Number.isSafeInteger(index) ||
      index <= last ||
      attempt.status === "running" ||
      !attempt.parent ||
      !ids.has(attempt.parent)
    )
      throw new Error("Invalid iteration history");
    ids.add(attempt.id);
    last = index;
  }
  if (!Number.isSafeInteger(last + budgets.maxIterations))
    throw new Error("Iteration limit is too large");
  if (
    !isDeepStrictEqual(
      Object.keys(baseline.measurements).sort(),
      Object.keys(accepted.at(-1)!.measurements).sort(),
    )
  )
    throw new Error("Accepted snapshot has different scenarios");
  if (baseline.cost !== 1)
    throw new Error("Resume requires a cost-based baseline; start a new run");
  const scenarios = Object.keys(baseline.measurements);
  for (const attempt of [baseline, accepted.at(-1)!]) {
    const cost = calculateCost(
      baseline.measurements,
      attempt.measurements,
      scenarios,
      report.config,
    );
    if (cost === null || cost !== attempt.cost)
      throw new Error("Accepted snapshot has invalid cost");
  }
  return {
    startedAt: startedAt.toISOString(),
    budgets: { ...budgets },
    firstIteration: last + 1,
    status: "running",
    environment,
  };
}

export function beginResume(report: Report, period: RunPeriod): void {
  if (!report.periods) {
    report.periods = [
      {
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        budgets: { ...report.config.budgets },
        firstIteration: 1,
        status: report.status,
        stopReason: report.stopReason,
        environment: report.environment,
      },
    ];
  }
  report.periods.push(period);
  report.status = "running";
  delete report.finishedAt;
  delete report.stopReason;
}

export function assertCompatibleEnvironment(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): void {
  for (const key of [
    "node",
    "runtimeVersions",
    "platform",
    "release",
    "arch",
    "totalMemory",
    "timezone",
    "locale",
    "nodeOptions",
    "root",
  ]) {
    if (!isDeepStrictEqual(previous[key], current[key]))
      throw new Error(`Environment changed: ${key}; start a new run`);
  }
  const models = (value: unknown) =>
    Array.isArray(value)
      ? value.map((cpu: { model: string }) => cpu.model)
      : undefined;
  if (!isDeepStrictEqual(models(previous.cpus), models(current.cpus)))
    throw new Error("Environment changed: CPUs; start a new run");
}

export async function withRunLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = join(directory, ".run-lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Run is locked by another process", { cause: error });
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true });
  }
}
