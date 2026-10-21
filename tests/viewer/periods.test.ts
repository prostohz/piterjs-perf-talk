import { expect, it } from "vitest";
import { createReport } from "../../src/pipeline/report.js";
import { parseReport } from "../../src/viewer/data.js";
import { workingDurationMs } from "../../src/viewer/model.js";
import { settings } from "../config.fixture.js";

it("excludes pauses from duration and includes the current working period", () => {
  const report = createReport(
    "fixture",
    settings(),
    new Date("2026-10-13T10:00:00Z"),
    {},
  );
  const first = report.periods![0]!;
  first.finishedAt = "2026-10-13T10:10:00Z";
  first.status = "completed";
  report.periods!.push({
    ...first,
    startedAt: "2026-10-13T12:00:00Z",
    finishedAt: undefined,
    status: "running",
    firstIteration: 4,
  });
  expect(
    workingDurationMs(parseReport(report), Date.parse("2026-10-13T12:05:00Z")),
  ).toBe(15 * 60_000);
  report.periods![1]!.finishedAt = "2026-10-13T12:20:00Z";
  expect(workingDurationMs(parseReport(report))).toBe(30 * 60_000);
});

it("keeps reading duration from dates in legacy reports", () => {
  const report = createReport(
    "fixture",
    settings(),
    new Date("2026-10-13T10:00:00Z"),
    {},
  );
  delete report.periods;
  report.finishedAt = "2026-10-13T10:10:00Z";
  expect(workingDurationMs(parseReport(report))).toBe(10 * 60_000);
});

it("rejects malformed periods before rendering", () => {
  const report = createReport("fixture", settings(), new Date(), {});
  expect(() => parseReport({ ...report, periods: {} })).toThrow("периоды");
  report.periods![0]!.finishedAt = "not a date";
  expect(() => parseReport(report)).toThrow("период");
});
