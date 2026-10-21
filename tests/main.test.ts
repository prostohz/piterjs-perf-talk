import { expect, it } from "vitest";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { settings } from "./config.fixture.js";
import { project, normalTarget } from "./runtime/supervisor.fixture.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);

it("runs the pipeline npm script with config.ts from the project root", async () => {
  const root = await project(normalTarget);
  const manifest = JSON.parse(
    await readFile(join(repository, "package.json"), "utf8"),
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { pipeline: manifest.scripts.pipeline },
    }),
  );
  for (const directory of ["src", "node_modules"]) {
    await symlink(join(repository, directory), join(root, directory), "dir");
  }
  await writeFile(
    join(root, "config.ts"),
    `export default ${JSON.stringify(settings({ budgets: { maxDurationMinutes: 1, maxIterations: 1 } }))};`,
  );
  const { stdout } = await exec("npm", ["run", "pipeline", "--", "fixture"], {
    cwd: root,
  });
  expect(stdout).toContain("completed:");
  expect(stdout).toContain("Iteration limit reached");
});

it("shows help through the pipeline npm script", async () => {
  const { stdout } = await exec("npm", ["run", "pipeline", "--", "--help"], {
    cwd: repository,
  });
  expect(stdout).toContain("Usage: npm run pipeline -- <target>");
});

it.each([[], ["first", "second"]])(
  "rejects an invalid target argument count: %j",
  async (...args) => {
    await expect(
      exec("npm", ["run", "pipeline", "--", ...args], { cwd: repository }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Usage: npm run pipeline -- <target>"),
    });
  },
);
