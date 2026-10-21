import { expect, it } from "vitest";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { settings } from "./config.fixture.js";
import { run } from "../src/runtime/supervisor.js";
import { project, normalTarget } from "./runtime/supervisor.fixture.js";

it("resumes through npm without importing the current config.ts", async () => {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const root = await project(normalTarget);
  for (const name of ["src", "node_modules"])
    await symlink(join(repository, name), join(root, name), "dir");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { pipeline: "node --import tsx src/main.ts" },
    }),
  );
  await writeFile(
    join(root, "config.ts"),
    "throw new Error('Current config must not be loaded');",
  );
  const first = await run(
    root,
    "fixture",
    settings({
      budgets: { maxDurationMinutes: 1, maxIterations: 1 },
    }),
  );
  const { stdout } = await promisify(execFile)(
    "npm",
    [
      "run",
      "pipeline",
      "--",
      "resume",
      `fixture/${basename(first.directory)}`,
      "--minutes",
      "1",
      "--iterations",
      "2",
    ],
    { cwd: root },
  );
  expect(stdout).toContain(`completed: ${first.directory}`);
  const report = JSON.parse(
    await readFile(join(first.directory, "report.json"), "utf8"),
  );
  expect(report.attempts).toHaveLength(4);
  expect(report.attempts.at(-1).id).toBe("iteration-003");
  expect(report.config).toEqual(first.report.config);
});
