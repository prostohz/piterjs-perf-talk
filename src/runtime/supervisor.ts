import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { mkdir, realpath } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import { resolveTarget } from "../target.js";
import {
  createReport,
  currentPeriod,
  failReport,
  RunHistory,
  type Report,
} from "../pipeline/report.js";
import { cleanupSnapshot, snapshotPaths } from "../pipeline/snapshots.js";
import { Budget } from "./budget.js";
import { descendants, sendSignal } from "./processes.js";
import {
  assertCompatibleEnvironment,
  beginResume,
  resumePeriod,
  withRunLock,
} from "./resume.js";

function environment(root: string): Record<string, unknown> {
  return {
    node: process.version,
    runtimeVersions: process.versions,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpus: cpus().map((cpu) => ({ model: cpu.model, speed: cpu.speed })),
    totalMemory: totalmem(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: process.env.LANG,
    nodeOptions: process.env.NODE_OPTIONS,
    root,
  };
}

async function superviseWorker(
  root: string,
  directory: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<{ reason?: string; spawnError?: Error }> {
  const output = createWriteStream(join(directory, "worker.log"), {
    flags: "a",
  });
  const worker = fileURLToPath(new URL("./worker.ts", import.meta.url));
  const tsx = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../node_modules/tsx/dist/loader.mjs",
  );
  const child = spawn(
    process.execPath,
    ["--import", tsx, worker, directory, root],
    { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const closed = new Promise<void>((resolveClose) =>
    child.on("close", () => resolveClose()),
  );

  let reason: string | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  let spawnError: Error | undefined;
  let childPids: number[] = [];
  let stopping: Promise<void> | undefined;

  function kill(signalName: NodeJS.Signals): void {
    if (!child.pid) return;
    for (const pid of childPids) sendSignal(pid, signalName);
    sendSignal(-child.pid, signalName);
  }

  function stop(message: string): void {
    if (reason) return;
    reason = message;
    stopping = (async () => {
      try {
        if (child.pid) childPids = await descendants(child.pid);
      } catch (error) {
        reason += `; process discovery failed: ${String(error)}`;
      }
      kill("SIGTERM");
      forceTimer = setTimeout(() => kill("SIGKILL"), 500);
    })();
  }

  const abort = () => stop("Interrupted by user");
  let timer: NodeJS.Timeout;

  function scheduleDeadline(): void {
    const remaining = deadline - Date.now();
    timer = setTimeout(
      () => {
        if (Date.now() >= deadline) stop("Time budget exhausted");
        else scheduleDeadline();
      },
      Math.max(0, Math.min(remaining, 2_147_483_647)),
    );
  }

  scheduleDeadline();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  try {
    await new Promise<void>((resolveExit) => {
      child.on("error", (error) => {
        spawnError = error;
        resolveExit();
      });
      child.on("exit", () => resolveExit());
    });
  } finally {
    clearTimeout(timer!);
    await stopping;
    if (forceTimer) clearTimeout(forceTimer);
    signal?.removeEventListener("abort", abort);
    kill("SIGKILL");
    await closed;
    output.end();
    await finished(output);
  }
  return { reason, spawnError };
}

export async function run(
  root: string,
  target: string,
  config: Config,
  signal?: AbortSignal,
  startedAt = new Date(),
): Promise<{ directory: string; report: Report }> {
  root = await realpath(root);
  await resolveTarget(root, target);

  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = join(root, "runs", target, runId);
  await mkdir(directory, { recursive: true });
  const history = new RunHistory(
    directory,
    createReport(target, config, startedAt, environment(root)),
  );
  await history.save();

  return withRunLock(directory, () =>
    continueRun(root, directory, history, signal),
  );
}

export async function resume(
  root: string,
  runPath: string,
  budgets: Config["budgets"],
  signal?: AbortSignal,
  startedAt = new Date(),
): Promise<{ directory: string; report: Report }> {
  root = await realpath(root);
  const match =
    /^([a-zA-Z0-9][a-zA-Z0-9_-]*)\/([a-zA-Z0-9][a-zA-Z0-9_-]*)$/.exec(runPath);
  if (!match) throw new Error("Expected <target>/<run-id>");
  const target = match[1]!;
  await resolveTarget(root, target);
  const directory = join(root, "runs", target, match[2]!);
  if (
    (await realpath(directory)) !== directory ||
    (await realpath(join(directory, "report.json"))) !==
      join(directory, "report.json")
  )
    throw new Error("Run paths must not be symlinks");
  return withRunLock(directory, async () => {
    const history = await RunHistory.load(directory);
    if (history.report.target !== target)
      throw new Error("Run target does not match directory");
    const actualEnvironment = environment(root);
    const period = resumePeriod(
      history.report,
      budgets,
      startedAt,
      actualEnvironment,
    );
    assertCompatibleEnvironment(history.report.environment, actualEnvironment);
    signal?.throwIfAborted();
    beginResume(history.report, period);
    await history.save();
    return continueRun(root, directory, history, signal);
  });
}

async function continueRun(
  root: string,
  directory: string,
  history: RunHistory,
  signal?: AbortSignal,
): Promise<{ directory: string; report: Report }> {
  const period = currentPeriod(history.report);
  const previousAttempts = history.report.attempts.length;
  const budget = new Budget(
    period.startedAt,
    period.budgets.maxDurationMinutes,
    signal ?? new AbortController().signal,
  );
  const { reason, spawnError } = await superviseWorker(
    root,
    directory,
    budget.deadline,
    signal,
  );
  const completed = await RunHistory.load(directory);
  const { report } = completed;

  for (const attempt of report.attempts.slice(previousAttempts)) {
    await cleanupSnapshot(snapshotPaths(directory, attempt.id));
  }

  if (reason || spawnError || report.status === "running") {
    const message =
      reason ??
      spawnError?.message ??
      "Worker exited before saving a final result";
    failReport(report, message, Boolean(reason), message);
    await completed.save();
  }

  return { directory, report };
}
