import { expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

it("parses both resume budget flags in either order", () => {
  expect(
    parseArgs([
      "resume",
      "fixture/run",
      "--iterations",
      "10",
      "--minutes",
      "60",
    ]),
  ).toEqual({
    type: "resume",
    path: "fixture/run",
    budgets: { maxDurationMinutes: 60, maxIterations: 10 },
  });
});

it.each([
  ["resume"],
  ["resume", "fixture/run", "--minutes", "60"],
  ["resume", "fixture/run", "--minutes", "60", "--minutes", "10"],
  ["resume", "fixture/run", "--minutes", "0", "--iterations", "10"],
  ["resume", "fixture/run", "--minutes", "Infinity", "--iterations", "10"],
  ["resume", "fixture/run", "--minutes", "60", "--iterations", "1.5"],
  ["resume", "fixture/run", "--minutes", "60", "--iterations", "0"],
  ["resume", "fixture/run", "--minutes", "60", "--iterations", "-1"],
])("rejects invalid resume arguments: %j", (...args) => {
  expect(() => parseArgs(args)).toThrow();
});
