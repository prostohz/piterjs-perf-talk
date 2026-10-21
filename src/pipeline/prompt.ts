import type { Config } from "../config.js";
import { directions } from "./metrics.js";
import type { Attempt } from "./report.js";

export const hypothesisSchema = {
  type: "object",
  properties: { hypothesis: { type: "string" } },
  required: ["hypothesis"],
  additionalProperties: false,
};

export function createPrompt(
  config: Config,
  scenarios: string[],
  history: Attempt[],
): string {
  return [
    "Optimize the library in the current working directory for the measured scenarios.",
    "Choose exactly one hypothesis, explain the proposed change and why it should improve the target metric, then implement it.",
    "Minimize cost: the equal-weight mean across all scenarios of candidateMedian / originalBaselineMedian for lower-is-better metrics, or originalBaselineMedian / candidateMedian for higher-is-better metrics. The original baseline is fixed for the entire run. Per-scenario regressions are allowed. Acceptance requires cost improvement from the last accepted snapshot of at least minImprovementPercent. A zero reference cost cannot improve further.",
    "Before finishing, call verify_library to build the current snapshot and run all library tests. If it reports build or test failures, repair this same hypothesis and call verify_library again in this session until it passes or the run is interrupted.",
    "Finish only after verify_library succeeds for your final source code. Any further edit requires another verification. Do not run performance scenarios; the pipeline evaluates them after you finish.",
    "Preserve public API and behavior. Do not change, remove, disable, skip, or exclude existing tests.",
    "Do not add, remove, or update dependencies or lockfiles. Do not modify package manifests, build/test configuration, scripts, fixtures, or the target harness.",
    "Only change implementation source files in this directory. Never edit parent directories, reports, the pipeline, or other snapshots.",
    "Use verify_library for dependency installation, build and tests. It prepares a fresh snapshot environment using the target lockfiles. Do not create Git repositories or leave background processes.",
    "Do not manipulate benchmark detection, timing, metrics, or environment to obtain a better score.",
    "You may independently research optimization ideas. Return the hypothesis in the required JSON format.",
    JSON.stringify({
      targetMetric: config.targetMetric,
      direction:
        directions[config.targetMetric] === -1
          ? "lower-is-better"
          : "higher-is-better",
      minImprovementPercent: config.minImprovementPercent,
      scenarios,
      history: history.map((attempt) => ({
        id: attempt.id,
        parent: attempt.parent,
        status: attempt.status,
        stage: attempt.stage,
        hypothesis: attempt.hypothesis,
        measurements: attempt.measurements,
        cost: attempt.cost,
        errors: attempt.errors,
        decision: attempt.decision,
      })),
    }),
  ].join("\n\n");
}

export function readHypothesis(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    !("hypothesis" in value) ||
    typeof value.hypothesis !== "string" ||
    !value.hypothesis.trim()
  ) {
    throw new Error("Agent returned no hypothesis");
  }
  return value.hypothesis;
}
