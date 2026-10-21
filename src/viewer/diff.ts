import { execFile } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
import { manifest } from "../pipeline/integrity.js";
import { readRun, safePath } from "./data.js";
import type { AttemptDiff } from "./model.js";

const exec = promisify(execFile);

export async function readAttemptDiff(
  root: string,
  target: string,
  run: string,
  id: string,
): Promise<AttemptDiff> {
  const { report } = await readRun(root, target, run);
  const attempt = report.attempts.find((item) => item.id === id);
  if (!attempt) throw new Error("Гипотеза не найдена");
  if (attempt.parent === null) return { parent: null, patch: "" };
  if (attempt.status === "running")
    throw new Error("Дифф будет доступен после завершения итерации");
  return readSnapshotDiff(root, target, run, attempt.parent, attempt.id);
}

export async function readRunDiff(
  root: string,
  target: string,
  run: string,
): Promise<AttemptDiff> {
  const { report } = await readRun(root, target, run);
  const baseline = report.attempts.find((attempt) => attempt.parent === null);
  const best = report.attempts.find((attempt) => attempt.id === report.best);
  if (!baseline || !best || best.status !== "accepted")
    throw new Error("Принятой версии пока нет");
  if (baseline.id === best.id) return { parent: baseline.id, patch: "" };
  return readSnapshotDiff(root, target, run, baseline.id, best.id);
}

async function readSnapshotDiff(
  root: string,
  target: string,
  run: string,
  parent: string,
  id: string,
): Promise<AttemptDiff> {
  const directory = await safePath(root, [target, run]);
  const before = await safePath(directory, [parent, "library"]);
  const after = await safePath(directory, [id, "library"]);
  await Promise.all([manifest(before), manifest(after)]);
  let patch: string;
  try {
    ({ stdout: patch } = await exec(
      "git",
      [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        relative(directory, before),
        relative(directory, after),
      ],
      { cwd: directory, maxBuffer: 2 * 1024 * 1024, timeout: 15_000 },
    ));
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    if (failure.code !== 1 || typeof failure.stdout !== "string")
      throw new Error("Не удалось построить дифф слепков", { cause: error });
    patch = failure.stdout;
  }
  return { parent, patch };
}
