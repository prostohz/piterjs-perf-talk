import type { CodingAgent } from "../agents/types.js";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { Budget } from "../runtime/budget.js";
import { errorMessage } from "../runtime/errors.js";
import type { Target } from "../target.js";
import { evaluate, type EvaluationContext } from "./evaluate.js";
import { manifest } from "./integrity.js";
import { executeIteration } from "./iteration.js";
import {
  failReport,
  currentPeriod,
  RunHistory,
  type AttemptContext,
  type Report,
} from "./report.js";
import { copyLibrary, snapshotPaths } from "./snapshots.js";
import { assertAllowedChanges, assertUnchanged } from "./integrity.js";
import { calculateCost } from "./metrics.js";

export interface PipelineOptions {
  directory: string;
  source: string;
  report: Report;
  loadTarget(): Promise<Target>;
  agent: CodingAgent;
  signal: AbortSignal;
  checkIntegrity(): Promise<void>;
}

async function evaluateBaseline(
  source: string,
  context: EvaluationContext,
): Promise<AttemptContext> {
  const baseline = await context.history.startAttempt("baseline", null);
  await context.budget.within(() =>
    copyLibrary(source, baseline.paths.library),
  );
  await evaluate(baseline, context);
  baseline.record.cost = calculateCost(
    baseline.record.measurements,
    baseline.record.measurements,
    context.target.scenarios,
    context.config,
  );
  await context.history.completeAttempt(baseline);
  return baseline;
}

export async function executePipeline(
  options: PipelineOptions,
): Promise<Report> {
  const { directory, source, report, agent, signal, checkIntegrity } = options;
  const { config } = report;
  const period = currentPeriod(report);
  const budget = new Budget(
    period.startedAt,
    period.budgets.maxDurationMinutes,
    signal,
  );
  const history = new RunHistory(directory, report);

  try {
    const loaded = await budget.within(options.loadTarget);
    const target = {
      scenarios: [...loaded.scenarios],
      prepare: loaded.prepare.bind(loaded),
    };
    const context: EvaluationContext = {
      config,
      target,
      budget,
      history,
      checkIntegrity,
    };
    const continuing = report.attempts.length > 0;
    const savedBaseline = report.attempts.find(
      (attempt) => attempt.id === "baseline",
    );
    const baseline = continuing
      ? { record: savedBaseline!, paths: snapshotPaths(directory, "baseline") }
      : await evaluateBaseline(source, context);
    if (!baseline.record || baseline.record.status !== "accepted")
      throw new Error("Resume requires a completed baseline");
    if (continuing) {
      assertUnchanged(
        Object.fromEntries(
          Object.keys(baseline.record.measurements).map((name) => [name, name]),
        ),
        Object.fromEntries(target.scenarios.map((name) => [name, name])),
        "Scenarios",
      );
    }
    const original = await manifest(baseline.paths.library);
    let reference = baseline;
    if (continuing) {
      const best = report.attempts.find(
        (attempt) => attempt.id === report.best,
      );
      if (!best || best.status !== "accepted")
        throw new Error("Missing accepted reference");
      reference = { record: best, paths: snapshotPaths(directory, best.id) };
      const canonicalDirectory = await realpath(directory);
      for (const attempt of [baseline, reference]) {
        if (
          (await realpath(attempt.paths.library)) !==
          join(canonicalDirectory, attempt.record.id, "library")
        )
          throw new Error("Saved snapshot paths must not be symlinks");
        const actual = await manifest(attempt.paths.library);
        if (attempt.record.sourceManifest)
          assertUnchanged(
            attempt.record.sourceManifest,
            actual,
            "Saved snapshot",
          );
        assertAllowedChanges(original, actual);
      }
    }

    for (let offset = 0; offset < period.budgets.maxIterations; offset++) {
      const index = period.firstIteration + offset;
      const attempt = await executeIteration(reference, index, {
        ...context,
        agent,
        original,
        baseline: baseline.record.measurements,
      });
      if (attempt.record.status === "accepted") reference = attempt;
    }

    await history.finish();
  } catch (error) {
    failReport(report, errorMessage(error), budget.interrupted);
    await history.save();
  }

  return report;
}
