import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { listRuns, parseReport, readRun } from "../../src/viewer/data.js";
import {
  complete,
  improvement,
  reference,
  scenarios,
} from "../../src/viewer/model.js";
import { createViewerApi } from "../../src/viewer/server.js";
import { createReport, type Attempt } from "../../src/pipeline/report.js";
import { summarize } from "../../src/pipeline/metrics.js";
import { settings } from "../config.fixture.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "perf-viewer-"));
  roots.push(root);
  const report = createReport(
    "one",
    settings(),
    new Date("2026-10-13T10:00:00Z"),
    {},
  );
  const attempt: Attempt = {
    id: "baseline",
    parent: null,
    status: "accepted",
    stage: "done",
    errors: [],
    measurements: { scenario: { operationTimeMs: summarize([10, 12, 14]) } },
  };
  report.attempts.push(attempt);
  report.best = "baseline";
  const save = async (target: string, id: string, value: unknown) => {
    const path = join(root, target, id);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "report.json"), JSON.stringify(value));
    return path;
  };
  return { root, report, attempt, save };
}

it("indexes every target, orders runs by start, and retains broken reports", async () => {
  const f = await fixture();
  await f.save("one", "old", f.report);
  await f.save("two", "new", {
    ...f.report,
    target: "two",
    startedAt: "2026-10-13T11:00:00Z",
  });
  await f.save("one", "broken", {});
  await mkdir(join(f.root, "one", "unfinished"));
  await symlink(join(f.root, "one"), join(f.root, "linked"));
  const { runs } = await listRuns(f.root);
  expect(runs).toHaveLength(4);
  expect(runs.filter((r) => !r.error).map((r) => r.id)).toEqual(["new", "old"]);
  expect(runs.filter((r) => r.error)).toHaveLength(2);
  expect(runs.find((r) => r.id === "old")).toMatchObject({
    attempts: 0,
    accepted: 0,
  });
  expect(await listRuns(join(f.root, "missing"))).toEqual({ runs: [] });
});

it("reads partial history, missing events, and newly written results", async () => {
  const f = await fixture();
  const path = await f.save("one", "run", f.report);
  expect((await readRun(f.root, "one", "run")).events).toBe("");
  f.report.attempts.push({
    ...f.attempt,
    id: "iteration-001",
    parent: "baseline",
    status: "interrupted",
    measurements: { partial: { operationTimeMs: summarize([8]) } },
  });
  await f.save("one", "run", f.report);
  await writeFile(join(path, "events.jsonl"), '{"stage":"measure"}\n');
  const data = await readRun(f.root, "one", "run");
  expect(data.report.attempts).toHaveLength(2);
  expect(scenarios(data.report)).toEqual(["scenario", "partial"]);
  expect(
    complete(
      data.report.attempts[1]!.measurements.partial!.operationTimeMs,
      data.report,
    ),
  ).toBe(false);
  expect(data.events).toContain("measure");
});

it("rejects malformed statistics and broken parent links", async () => {
  const f = await fixture();
  f.attempt.measurements.scenario!.operationTimeMs!.median = NaN;
  expect(() => parseReport(f.report)).toThrow("статистика");
  f.attempt.measurements = {};
  f.attempt.parent = "missing";
  expect(() => parseReport(f.report)).toThrow("история");
});

it("compares against the parent, handles FPS direction and zero references", async () => {
  const f = await fixture();
  const rejected = {
    ...f.attempt,
    id: "iteration-001",
    parent: "baseline",
    status: "rejected" as const,
  };
  const next = { ...f.attempt, id: "iteration-002", parent: "baseline" };
  f.report.attempts.push(rejected, next);
  expect(reference(f.report, next)).toBe(f.attempt);
  expect(improvement(100, 80, "operationTimeMs")).toBe(20);
  expect(improvement(50, 60, "rafFps")).toBe(20);
  expect(improvement(10, 12, "reactCommits")).toBe(-20);
  expect(improvement(0, 0, "reactCommits")).toBe(0);
  expect(improvement(0, 1, "operationTimeMs")).toBeNull();
});

it("serves the API without exposing files outside runs or accepting writes", async () => {
  const f = await fixture();
  const directory = await f.save("one", "run", f.report);
  const api = createViewerApi(f.root);
  const server = createServer((request, response) => {
    void api(request, response, () => {
      response.writeHead(404);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  const base = `http://127.0.0.1:${address.port}`;
  expect(
    (await fetch(`${base}/api/runs`).then((r) => r.json())).runs,
  ).toHaveLength(1);
  expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  expect((await fetch(`${base}/api/diff?target=one&run=run`)).status).toBe(400);
  expect((await fetch(`${base}/api/run-diff?target=one`)).status).toBe(400);
  expect(
    await fetch(`${base}/api/run-diff?target=one&run=run`).then((r) =>
      r.json(),
    ),
  ).toEqual({ parent: "baseline", patch: "" });
  expect(
    await fetch(`${base}/api/diff?target=one&run=run&attempt=baseline`).then(
      (r) => r.json(),
    ),
  ).toEqual({ parent: null, patch: "" });
  expect(
    (await fetch(`${base}/api/diff?target=one&run=run&attempt=missing`)).status,
  ).toBe(422);
  expect((await fetch(`${base}/api/runs`, { method: "POST" })).status).toBe(
    405,
  );
  expect((await fetch(`${base}/report.json`)).status).toBe(404);
  expect((await fetch(`${base}/api/run?target=..&run=run`)).status).toBe(422);
  const outside = await mkdtemp(join(tmpdir(), "outside-viewer-"));
  roots.push(outside);
  await writeFile(join(outside, "report.json"), JSON.stringify(f.report));
  await rm(join(directory, "report.json"));
  await symlink(join(outside, "report.json"), join(directory, "report.json"));
  expect((await fetch(`${base}/api/run?target=one&run=run`)).status).toBe(422);
});

it("reads cost decisions and rejects malformed cost fields", async () => {
  const f = await fixture();
  f.attempt.cost = null;
  f.attempt.decision = {
    accepted: false,
    reasons: ["Candidate cost is not finite"],
    referenceCost: 1,
    improvementPercent: null,
  };
  expect(parseReport(f.report).attempts[0]).toMatchObject({
    cost: null,
    decision: { referenceCost: 1, improvementPercent: null },
  });
  f.attempt.cost = Infinity;
  expect(() => parseReport(f.report)).toThrow("cost");
  f.attempt.cost = 0.5;
  f.attempt.decision.referenceCost = -1;
  expect(() => parseReport(f.report)).toThrow("referenceCost");
  f.attempt.decision.referenceCost = 1;
  f.attempt.decision.improvementPercent = NaN;
  expect(() => parseReport(f.report)).toThrow("improvementPercent");
});
