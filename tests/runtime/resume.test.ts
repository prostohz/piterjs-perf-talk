import { expect, it, vi } from "vitest";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { run, resume } from "../../src/runtime/supervisor.js";
import { RunHistory } from "../../src/pipeline/report.js";
import { manifest } from "../../src/pipeline/integrity.js";
import { exists } from "../../src/pipeline/snapshots.js";
import { settings } from "../config.fixture.js";
import { project, normalTarget } from "./supervisor.fixture.js";
import { workingDurationMs } from "../../src/viewer/model.js";

const budgets = { maxDurationMinutes: 1, maxIterations: 2 };
const config = () => settings({ budgets });
const path = (directory: string) => `fixture/${basename(directory)}`;

it("continues one report from best, preserves every old snapshot and appends logs", async () => {
  const root = await project(normalTarget);
  const first = await run(root, "fixture", config());
  expect(first.report.status, first.report.stopReason).toBe("completed");
  const previous = structuredClone(first.report);
  const baselineFiles = await manifest(join(first.directory, "baseline"));
  const rejectedFiles = await manifest(join(first.directory, "iteration-002"));
  await appendFile(join(first.directory, "worker.log"), "previous output\n");
  const events = await readFile(join(first.directory, "events.jsonl"), "utf8");
  await writeFile(join(root, "config.ts"), "invalid current config");
  const result = await resume(root, path(first.directory), budgets);
  expect(result.directory).toBe(first.directory);
  expect(result.report.status, result.report.stopReason).toBe("completed");
  expect(result.report.attempts.map((attempt) => attempt.id)).toEqual([
    "baseline",
    "iteration-001",
    "iteration-002",
    "iteration-003",
    "iteration-004",
  ]);
  expect(result.report.attempts.slice(0, 3)).toEqual(previous.attempts);
  expect(
    result.report.attempts.slice(3).map((attempt) => attempt.parent),
  ).toEqual(["iteration-001", "iteration-001"]);
  expect(result.report.best).toBe("iteration-001");
  expect(result.report.config).toEqual(previous.config);
  expect(result.report.environment).toEqual(previous.environment);
  expect(result.report.startedAt).toBe(previous.startedAt);
  expect(result.report.periods).toHaveLength(2);
  expect(result.report.periods![0]).toEqual(previous.periods![0]);
  expect(result.report.periods![1]).toMatchObject({
    firstIteration: 3,
    budgets,
    status: "completed",
  });
  expect(await manifest(join(first.directory, "baseline"))).toEqual(
    baselineFiles,
  );
  expect(await manifest(join(first.directory, "iteration-002"))).toEqual(
    rejectedFiles,
  );
  expect(await readFile(join(first.directory, "worker.log"), "utf8")).toContain(
    "previous output",
  );
  expect(
    (await readFile(join(first.directory, "events.jsonl"), "utf8")).startsWith(
      events,
    ),
  ).toBe(true);
  const prompt = await readFile(
    join(first.directory, "iteration-003/agent/prompt.txt"),
    "utf8",
  );
  expect(prompt).toContain('"id":"iteration-002"');
  expect(prompt).not.toContain("sourceManifest");
  expect(await exists(join(first.directory, ".run-lock"))).toBe(false);
}, 20_000);

it("resumes a cost-based report without period metadata or repeating baseline", async () => {
  const root = await project(
    normalTarget.replace(
      "const value = Number",
      `if (path.endsWith('/baseline/library')) {
      const marker = join(process.cwd(), 'baseline-prepared');
      try { await readFile(marker); throw new Error('Baseline repeated'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(marker, 'yes');
    }
    const value = Number`,
    ),
  );
  const first = await run(
    root,
    "fixture",
    settings({
      budgets: { ...budgets, maxIterations: 0 },
    }),
  );
  expect(first.report.status, first.report.stopReason).toBe("completed");
  const history = await RunHistory.load(first.directory);
  delete history.report.periods;
  for (const attempt of history.report.attempts) delete attempt.sourceManifest;
  history.report.startedAt = "2020-01-01T00:00:00.000Z";
  history.report.finishedAt = "2020-01-01T00:00:01.000Z";
  await history.save();
  const result = await resume(root, path(first.directory), {
    ...budgets,
    maxIterations: 1,
  });
  expect(result.report.status, result.report.stopReason).toBe("completed");
  expect(result.report.attempts).toHaveLength(2);
  expect(result.report.periods).toHaveLength(2);
  expect(workingDurationMs(result.report)).toBeLessThan(30_000);
  expect(result.report.periods![0]!.startedAt).toBe(history.report.startedAt);
});

it("retains an interrupted attempt and resumes from baseline at the next number", async () => {
  const root = await project(
    normalTarget.replace(
      "async test() {}",
      `async test() {
    if (value !== 100) {
      try { await readFile(join(process.cwd(), 'continue')); }
      catch { await writeFile(join(process.cwd(), 'waiting'), 'yes'); await new Promise(() => {}); }
    }
  }`,
    ),
  );
  const controller = new AbortController();
  const pending = run(root, "fixture", config(), controller.signal);
  await vi.waitFor(
    async () => expect(await exists(join(root, "waiting"))).toBe(true),
    { timeout: 5000 },
  );
  controller.abort();
  const first = await pending;
  expect(first.report.status).toBe("interrupted");
  expect(first.report.attempts[1]!.status).toBe("interrupted");
  const oldAttempt = structuredClone(first.report.attempts[1]);
  const oldFiles = await manifest(join(first.directory, "iteration-001"));
  await writeFile(join(root, "continue"), "yes");
  const result = await resume(root, path(first.directory), {
    ...budgets,
    maxIterations: 1,
  });
  expect(result.report.status, result.report.stopReason).toBe("completed");
  expect(result.report.attempts[1]).toEqual(oldAttempt);
  expect(await manifest(join(first.directory, "iteration-001"))).toEqual(
    oldFiles,
  );
  expect(result.report.attempts[2]).toMatchObject({
    id: "iteration-002",
    parent: "baseline",
    status: "accepted",
  });
});

it("rejects concurrent resumes while a worker is blocked and enforces the new deadline", async () => {
  const root = await project(
    normalTarget.replace(
      "async test() {}",
      `async test() {
    if (value !== 100) {
      await writeFile(join(process.cwd(), 'waiting'), 'yes');
      await new Promise(() => {});
    }
  }`,
    ),
  );
  const first = await run(
    root,
    "fixture",
    settings({
      budgets: { ...budgets, maxIterations: 0 },
    }),
  );
  const pending = resume(root, path(first.directory), {
    maxDurationMinutes: 0.06,
    maxIterations: 10,
  });
  await vi.waitFor(
    async () => expect(await exists(join(root, "waiting"))).toBe(true),
    { timeout: 5000 },
  );
  await expect(resume(root, path(first.directory), budgets)).rejects.toThrow(
    "locked",
  );
  const result = await pending;
  expect(result.report.status).toBe("interrupted");
  expect(result.report.stopReason).toBe("Time budget exhausted");
  expect(result.report.periods![1]).toMatchObject({
    status: "interrupted",
    stopReason: "Time budget exhausted",
  });
  expect(result.report.attempts[1]!.status).toBe("interrupted");
  expect(result.report.best).toBe("baseline");
  expect(await exists(join(first.directory, ".run-lock"))).toBe(false);
}, 10_000);

it.each(["target", "agent", "snapshot"])(
  "stops before a new attempt when %s changed",
  async (changed) => {
    const root = await project(normalTarget);
    const first = await run(root, "fixture", config());
    if (changed === "target")
      await appendFile(
        join(root, "targets/fixture/target.ts"),
        "\nexport const changed = true;\n",
      );
    if (changed === "agent") {
      const file = join(root, "bin/codex");
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace(
          "fake-codex 1.0",
          "fake-codex 2.0",
        ),
      );
    }
    if (changed === "snapshot")
      await appendFile(
        join(first.directory, "iteration-001/library/index.ts"),
        "\nexport const tampered = true;\n",
      );
    const result = await resume(root, path(first.directory), budgets);
    expect(result.report.status).toBe("failed");
    expect(result.report.stopReason).toContain("changed");
    expect(result.report.attempts).toEqual(first.report.attempts);
    expect(result.report.environment).toEqual(first.report.environment);
  },
);

it("rejects incompatible environment without changing the report", async () => {
  const root = await project(normalTarget);
  const first = await run(root, "fixture", config());
  const history = await RunHistory.load(first.directory);
  history.report.environment.node = "other-node";
  await history.save();
  const before = await readFile(join(first.directory, "report.json"), "utf8");
  await expect(resume(root, path(first.directory), budgets)).rejects.toThrow(
    "Environment changed: node",
  );
  expect(await readFile(join(first.directory, "report.json"), "utf8")).toBe(
    before,
  );
});

it("rejects failed baseline, active runs, unsafe paths and existing locks", async () => {
  const root = await project(
    normalTarget.replace(
      "async test() {}",
      "async test() { throw new Error('broken'); }",
    ),
  );
  const first = await run(root, "fixture", config());
  await expect(resume(root, path(first.directory), budgets)).rejects.toThrow(
    "completed baseline",
  );
  const history = await RunHistory.load(first.directory);
  history.report.status = "running";
  await history.save();
  await expect(resume(root, path(first.directory), budgets)).rejects.toThrow(
    "stopped run",
  );
  await expect(resume(root, "fixture/../../escape", budgets)).rejects.toThrow(
    "<target>/<run-id>",
  );
  await mkdir(join(first.directory, ".run-lock"));
  await expect(resume(root, path(first.directory), budgets)).rejects.toThrow(
    "locked",
  );
});

it("rejects a report without cost before changing saved history", async () => {
  const root = await project(normalTarget);
  const first = await run(root, "fixture", config());
  const history = await RunHistory.load(first.directory);
  delete history.report.attempts[0]!.cost;
  await history.save();
  const before = await readFile(join(first.directory, "report.json"), "utf8");
  await expect(resume(root, path(first.directory), budgets)).rejects.toThrow(
    "cost-based baseline",
  );
  expect(await readFile(join(first.directory, "report.json"), "utf8")).toBe(
    before,
  );
});
