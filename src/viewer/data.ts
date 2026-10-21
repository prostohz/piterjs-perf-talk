import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { validateConfig } from "../config.js";
import { directions } from "../pipeline/metrics.js";
import type { Report } from "../pipeline/report.js";
import type { Catalog, RunDetail, RunSummary } from "./model.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ожидался объект");
  return value as Record<string, unknown>;
}

function strings(value: unknown): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error("Ожидался список строк");
}

function optionalNumber(
  value: unknown,
  name: string,
  nonnegative = false,
): void {
  if (
    value !== undefined &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      (nonnegative && value < 0))
  )
    throw new Error(`Некорректное поле ${name}`);
}

export function parseReport(value: unknown): Report {
  const report = record(value);
  validateConfig(report.config);
  record(report.environment);
  if (
    typeof report.target !== "string" ||
    typeof report.startedAt !== "string" ||
    !Number.isFinite(Date.parse(report.startedAt)) ||
    !["running", "completed", "failed", "interrupted"].includes(
      String(report.status),
    ) ||
    !Array.isArray(report.attempts)
  )
    throw new Error("Неизвестный формат report.json");
  for (const key of ["finishedAt", "stopReason"])
    if (report[key] !== undefined && typeof report[key] !== "string")
      throw new Error(`Некорректное поле ${key}`);
  if (report.periods !== undefined) {
    if (!Array.isArray(report.periods) || !report.periods.length)
      throw new Error("Некорректные периоды работы");
    for (const value of report.periods) {
      const period = record(value);
      record(period.environment);
      validateConfig({ ...record(report.config), budgets: period.budgets });
      if (
        typeof period.startedAt !== "string" ||
        !Number.isFinite(Date.parse(period.startedAt)) ||
        (period.finishedAt !== undefined &&
          (typeof period.finishedAt !== "string" ||
            !Number.isFinite(Date.parse(period.finishedAt)) ||
            Date.parse(period.finishedAt) < Date.parse(period.startedAt))) ||
        typeof period.firstIteration !== "number" ||
        !Number.isSafeInteger(period.firstIteration) ||
        period.firstIteration < 1 ||
        !["running", "completed", "failed", "interrupted"].includes(
          String(period.status),
        ) ||
        (period.stopReason !== undefined &&
          typeof period.stopReason !== "string")
      )
        throw new Error("Некорректный период работы");
    }
  }
  const ids = new Set<string>();
  for (const value of report.attempts) {
    const a = record(value);
    if (
      typeof a.id !== "string" ||
      ids.has(a.id) ||
      (a.parent !== null &&
        (typeof a.parent !== "string" || !ids.has(a.parent))) ||
      typeof a.stage !== "string" ||
      !["running", "accepted", "rejected", "failed", "interrupted"].includes(
        String(a.status),
      )
    )
      throw new Error("Некорректная история итераций");
    ids.add(a.id);
    if (a.hypothesis !== undefined && typeof a.hypothesis !== "string")
      throw new Error("Некорректная гипотеза");
    strings(a.errors);
    if (a.cost !== null) optionalNumber(a.cost, "cost", true);
    if (a.decision !== undefined) {
      const decision = record(a.decision);
      if (typeof decision.accepted !== "boolean")
        throw new Error("Некорректное решение");
      strings(decision.reasons);
      optionalNumber(decision.referenceCost, "referenceCost", true);
      if (decision.improvementPercent !== null)
        optionalNumber(decision.improvementPercent, "improvementPercent");
    }
    for (const metrics of Object.values(record(a.measurements))) {
      for (const [key, value] of Object.entries(record(metrics))) {
        if (!Object.hasOwn(directions, key))
          throw new Error(`Неизвестная метрика: ${key}`);
        const stats = record(value);
        if (
          !Array.isArray(stats.samples) ||
          !stats.samples.length ||
          stats.samples.some(
            (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
          )
        )
          throw new Error("Некорректная серия замеров");
        for (const field of ["median", "p95", "min", "max", "spread"])
          if (
            typeof stats[field] !== "number" ||
            !Number.isFinite(stats[field]) ||
            stats[field] < 0
          )
            throw new Error(`Некорректная статистика: ${field}`);
      }
    }
  }
  if (
    report.best !== null &&
    (typeof report.best !== "string" || !ids.has(report.best))
  )
    throw new Error("Некорректный best");
  return value as Report;
}

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function safePath(root: string, parts: string[]): Promise<string> {
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || /[/\\\0]/.test(part),
    )
  )
    throw new Error("Недопустимый путь");
  const base = await realpath(root);
  const file = await realpath(join(base, ...parts));
  const path = relative(base, file);
  if (path === ".." || path.startsWith("../") || isAbsolute(path))
    throw new Error("Путь вне runs");
  return file;
}

async function safeFile(root: string, parts: string[]): Promise<string> {
  return readFile(await safePath(root, parts), "utf8");
}

export async function readRun(
  root: string,
  target: string,
  id: string,
): Promise<RunDetail> {
  const report = parseReport(
    JSON.parse(await safeFile(root, [target, id, "report.json"])),
  );
  let events = "";
  try {
    events = await safeFile(root, [target, id, "events.jsonl"]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { report, events };
}

export async function listRuns(root: string): Promise<Catalog> {
  const runs: RunSummary[] = [];
  for (const target of await directories(root)) {
    for (const id of await directories(join(root, target))) {
      try {
        const report = parseReport(
          JSON.parse(await safeFile(root, [target, id, "report.json"])),
        );
        runs.push({
          target,
          id,
          startedAt: report.startedAt,
          status: report.status,
          attempts: report.attempts.filter((a) => a.parent !== null).length,
          accepted: report.attempts.filter(
            (a) => a.parent !== null && a.status === "accepted",
          ).length,
        });
      } catch (error) {
        runs.push({
          target,
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  runs.sort((a, b) => (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id));
  return { runs };
}
