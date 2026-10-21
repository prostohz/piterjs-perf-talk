import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MeasurementWorker } from "../../src/target.js";
import { execute, setup } from "./run.fixture.js";

it("runs at most five scenarios concurrently and keeps every scenario on one worker", async () => {
  const f = await setup();
  f.report.config.measurements = { repeats: 3, workers: 5 };
  f.report.config.budgets.maxIterations = 0;
  f.target.scenarios = Array.from({ length: 10 }, (_, i) => `scenario-${i}`);
  let active = 0;
  let maximum = 0;
  let created = 0;
  let tests = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed = new Set<number>();
  const owners = new Map<string, number>();
  const busy = new Set<number>();
  const makeWorker = (id: number): MeasurementWorker => ({
    async measure(scenario) {
      expect(busy.has(id)).toBe(false);
      busy.add(id);
      expect(owners.get(scenario) ?? id).toBe(id);
      owners.set(scenario, id);
      maximum = Math.max(maximum, ++active);
      if (maximum === 5) release();
      await gate;
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      busy.delete(id);
      return { operationTimeMs: 100 };
    },
    async close() {
      closed.add(id);
    },
  });
  f.target.prepare = async () => ({
    ...makeWorker(0),
    async test() {
      tests++;
    },
    async createWorker() {
      return makeWorker(++created);
    },
  });
  await execute(f, {
    async run() {
      throw new Error("Unexpected agent");
    },
  });
  expect(f.report.status, f.report.stopReason).toBe("completed");
  expect(maximum).toBe(5);
  expect(created).toBe(4);
  expect(tests).toBe(1);
  expect(closed.size).toBe(5);
  expect(owners.size).toBe(10);
  const measurements = f.report.attempts[0]!.measurements;
  for (const scenario of f.target.scenarios)
    expect(measurements[scenario]!.operationTimeMs!.samples).toEqual([
      100, 100, 100,
    ]);
  const saved = JSON.parse(
    await readFile(join(f.directory, "report.json"), "utf8"),
  );
  expect(saved.attempts[0].measurements).toEqual(measurements);
  const events = (await readFile(join(f.directory, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.filter((e) => e.state === "start")).toHaveLength(10);
  expect(events.filter((e) => e.state === "done")).toHaveLength(10);
  expect(
    new Set(events.filter((e) => e.scenario).map((e) => e.worker)).size,
  ).toBe(5);
});

it("stops all measurement workers on failure and preserves the first error and saved samples", async () => {
  const f = await setup();
  f.report.config.measurements = { repeats: 3, workers: 2 };
  let calls = 0;
  let blockedCalls = 0;
  let rejectBlocked!: (error: Error) => void;
  const closed = new Set<string>();
  const blocked = new Promise<Record<string, number>>((_resolve, reject) => {
    rejectBlocked = reject;
  });
  f.target.prepare = async () => ({
    async test() {},
    async measure() {
      if (++calls === 2) throw new Error("Wrong DOM");
      return { operationTimeMs: 100 };
    },
    async createWorker() {
      return {
        async measure() {
          blockedCalls++;
          return blocked;
        },
        async close() {
          closed.add("extra");
          rejectBlocked(new Error("Worker closed"));
        },
      };
    },
    async close() {
      closed.add("main");
    },
  });
  await execute(f, {
    async run() {
      throw new Error("Unexpected agent");
    },
  });
  expect(f.report.status).toBe("failed");
  expect(f.report.stopReason).toContain("Wrong DOM");
  expect(
    f.report.attempts[0]!.measurements.one!.operationTimeMs!.samples,
  ).toEqual([100]);
  expect(calls).toBe(2);
  expect(blockedCalls).toBe(1);
  expect([...closed].sort()).toEqual(["extra", "main"]);
});

it("closes already-created workers when a later worker cannot start", async () => {
  const f = await setup();
  f.report.config.measurements = { repeats: 3, workers: 3 };
  f.target.scenarios = ["one", "two", "three"];
  let created = 0;
  let measurements = 0;
  const closed = new Set<string>();
  f.target.prepare = async () => ({
    async test() {},
    async measure() {
      measurements++;
      return { operationTimeMs: 100 };
    },
    async createWorker() {
      if (++created === 2) throw new Error("Browser failed to start");
      return {
        async measure() {
          measurements++;
          return { operationTimeMs: 100 };
        },
        async close() {
          closed.add("extra");
        },
      };
    },
    async close() {
      closed.add("main");
    },
  });
  await execute(f, {
    async run() {
      throw new Error("Unexpected agent");
    },
  });
  expect(f.report.status).toBe("failed");
  expect(f.report.stopReason).toContain("Browser failed to start");
  expect(measurements).toBe(0);
  expect([...closed].sort()).toEqual(["extra", "main"]);
});

it("rejects parallel measurement for targets without worker support", async () => {
  const f = await setup();
  f.report.config.measurements.workers = 2;
  await execute(f, {
    async run() {
      throw new Error("Unexpected agent");
    },
  });
  expect(f.report.status).toBe("failed");
  expect(f.report.stopReason).toContain(
    "does not support parallel measurement workers",
  );
});
