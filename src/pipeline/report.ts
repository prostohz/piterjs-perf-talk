import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.js";
import type { Measurements } from "./metrics.js";
import { snapshotPaths, type SnapshotPaths } from "./snapshots.js";
import { manifest, type Manifest } from "./integrity.js";

export type Status =
  "running" | "accepted" | "rejected" | "failed" | "interrupted";

export interface Attempt {
  id: string;
  parent: string | null;
  status: Status;
  stage: string;
  hypothesis?: string;
  measurements: Measurements;
  cost?: number | null;
  errors: string[];
  decision?: {
    accepted: boolean;
    reasons: string[];
    referenceCost?: number;
    improvementPercent?: number | null;
  };
  sourceManifest?: Manifest;
}

export interface RunPeriod {
  startedAt: string;
  finishedAt?: string;
  budgets: Config["budgets"];
  firstIteration: number;
  status: Report["status"];
  stopReason?: string;
  environment: Record<string, unknown>;
}

export interface Report {
  target: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  stopReason?: string;
  config: Config;
  environment: Record<string, unknown>;
  attempts: Attempt[];
  best: string | null;
  periods?: RunPeriod[];
}

export interface AttemptContext {
  record: Attempt;
  paths: SnapshotPaths;
}

export function createReport(
  target: string,
  config: Config,
  startedAt: Date,
  environment: Record<string, unknown>,
): Report {
  return {
    target,
    startedAt: startedAt.toISOString(),
    status: "running",
    config,
    attempts: [],
    best: null,
    environment,
    periods: [
      {
        startedAt: startedAt.toISOString(),
        budgets: config.budgets,
        firstIteration: 1,
        status: "running",
        environment,
      },
    ],
  };
}

export function currentPeriod(report: Report): RunPeriod {
  const period = report.periods?.at(-1);
  if (!period) throw new Error("Run has no working period");
  return period;
}

function finishPeriod(report: Report): void {
  const period = report.periods?.at(-1);
  if (!period) return;
  period.finishedAt = report.finishedAt;
  period.status = report.status;
  period.stopReason = report.stopReason;
}

export function failReport(
  report: Report,
  reason: string,
  interrupted: boolean,
  decisionReason = interrupted ? "Interrupted" : "Execution failed",
): void {
  report.status = interrupted ? "interrupted" : "failed";
  report.stopReason = reason;
  report.finishedAt = new Date().toISOString();
  finishPeriod(report);

  const current = report.attempts.at(-1);
  if (current?.status === "running") {
    current.status = interrupted ? "interrupted" : "failed";
    current.errors.push(reason);
    current.decision = {
      accepted: false,
      reasons: [decisionReason],
    };
  }
}

export class RunHistory {
  private readonly reportPath: string;
  private readonly eventsPath: string;

  constructor(
    readonly directory: string,
    readonly report: Report,
  ) {
    this.reportPath = join(directory, "report.json");
    this.eventsPath = join(directory, "events.jsonl");
  }

  static async load(directory: string): Promise<RunHistory> {
    const report = JSON.parse(
      await readFile(join(directory, "report.json"), "utf8"),
    ) as Report;
    return new RunHistory(directory, report);
  }

  async save(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      `${this.reportPath}.tmp`,
      `${JSON.stringify(this.report, null, 2)}\n`,
    );
    await rename(`${this.reportPath}.tmp`, this.reportPath);
  }

  async startAttempt(
    id: string,
    parent: string | null,
  ): Promise<AttemptContext> {
    const paths = snapshotPaths(this.directory, id);
    await mkdir(paths.directory);
    const record: Attempt = {
      id,
      parent,
      status: "running",
      stage: "snapshot",
      measurements: Object.create(null),
      errors: [],
    };
    this.report.attempts.push(record);
    await this.save();
    return { record, paths };
  }

  async stage(attempt: AttemptContext, stage: string): Promise<void> {
    attempt.record.stage = stage;
    await this.save();
    await appendFile(
      this.eventsPath,
      `${JSON.stringify({ time: new Date().toISOString(), attempt: attempt.record.id, stage })}\n`,
    );
  }

  async completeAttempt(
    attempt: AttemptContext,
    decision?: NonNullable<Attempt["decision"]>,
  ): Promise<void> {
    attempt.record.sourceManifest = await manifest(attempt.paths.library);
    if (decision) attempt.record.decision = decision;
    const accepted = !decision || decision.accepted;
    attempt.record.status = accepted ? "accepted" : "rejected";
    attempt.record.stage = "done";
    if (accepted) this.report.best = attempt.record.id;
    await this.save();
  }

  async measurementEvent(
    attempt: AttemptContext,
    worker: number,
    scenario: string,
    state: "start" | "done",
  ): Promise<void> {
    await appendFile(
      this.eventsPath,
      `${JSON.stringify({ time: new Date().toISOString(), attempt: attempt.record.id, stage: "measure", worker, scenario, state })}\n`,
    );
  }

  async finish(): Promise<void> {
    this.report.status = "completed";
    this.report.stopReason = "Iteration limit reached";
    this.report.finishedAt = new Date().toISOString();
    finishPeriod(this.report);
    await this.save();
  }
}
