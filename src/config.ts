import { directions, type Metric } from "./pipeline/metrics.js";
import type { AgentSettings } from "./agents/types.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export interface Config {
  agent: AgentSettings;
  targetMetric: Metric;
  measurements: { repeats: number };
  budgets: { maxDurationMinutes: number; maxIterations: number };
  minImprovementPercent: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Expected a nonempty string");
}

function number(
  value: unknown,
  minimum: number,
  integer = false,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error(`Expected ${integer ? "integer" : "number"} >= ${minimum}`);
}

export function validateConfig(value: unknown): Config {
  const config = object(value);
  const agent = object(config.agent);
  for (const key of ["provider", "model", "reasoningEffort"]) text(agent[key]);
  if (
    typeof config.targetMetric !== "string" ||
    !Object.hasOwn(directions, config.targetMetric)
  )
    throw new Error("Unknown targetMetric");
  number(object(config.measurements).repeats, 1, true);
  number(object(config.budgets).maxDurationMinutes, Number.MIN_VALUE);
  number(object(config.budgets).maxIterations, 0, true);
  number(config.minImprovementPercent, Number.MIN_VALUE);
  return value as Config;
}

export async function loadConfig(root: string): Promise<Config> {
  const module = (await import(
    pathToFileURL(resolve(root, "config.ts")).href
  )) as { default: unknown };
  return validateConfig(module.default);
}
