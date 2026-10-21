import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import type { Metric } from "./pipeline/metrics.js";

const exec = promisify(execFile);

export interface Target {
  scenarios: string[];
  prepare(libraryPath: string): Promise<TargetSession>;
}

export interface TargetSession {
  test(): Promise<void>;
  measure(
    scenario: string,
    targetMetric: Metric,
  ): Promise<Record<string, number>>;
  close(): Promise<void>;
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

export function validateTarget(value: unknown): Target {
  const target = object(value);
  if (!Array.isArray(target.scenarios) || !target.scenarios.length)
    throw new Error("Target must define scenarios");
  target.scenarios.forEach(text);
  if (new Set(target.scenarios).size !== target.scenarios.length)
    throw new Error("Duplicate scenarios");
  if (typeof target.prepare !== "function")
    throw new Error("Target must define prepare");
  return value as Target;
}

export function validateSession(value: unknown): TargetSession {
  const session = object(value);
  for (const name of ["test", "measure", "close"])
    if (typeof session[name] !== "function")
      throw new Error(`Target session must define ${name}`);
  return value as TargetSession;
}

export async function libraryProvenance(
  source: string,
  declaration: unknown,
): Promise<Record<string, unknown>> {
  const value = declaration as Record<string, unknown>;
  if (
    !value ||
    typeof value.repository !== "string" ||
    typeof value.commit !== "string" ||
    !/^[a-f0-9]{40}$/i.test(value.commit)
  )
    throw new Error("Invalid source.json");
  const { stdout } = await exec("git", ["-C", source, "rev-parse", "HEAD"]);
  const { stdout: top } = await exec("git", [
    "-C",
    source,
    "rev-parse",
    "--show-toplevel",
  ]);
  if (resolve(top.trim()) !== resolve(source))
    throw new Error("Library must be a separate Git repository");
  if (stdout.trim() !== value.commit)
    throw new Error("Source commit does not match source.json");
  return { repository: value.repository, commit: stdout.trim() };
}

export async function resolveTarget(
  root: string,
  name: string,
): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name))
    throw new Error("Invalid target name");
  const directory = join(root, "targets", name);
  if (!existsSync(join(directory, "target.ts")))
    throw new Error(`Target not found: ${directory}/target.ts`);
  if ((await realpath(directory)) !== directory)
    throw new Error("Target directory must not be a symlink");
  return directory;
}

export async function loadTarget(directory: string): Promise<Target> {
  const module = (await import(
    pathToFileURL(join(directory, "target.ts")).href
  )) as { default: unknown };
  return validateTarget(module.default);
}
