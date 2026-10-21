import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

export async function fixture(): Promise<{
  root: string;
  source: string;
  commit: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "perf-pipeline-"));
  const source = join(root, "library");
  await mkdir(source);
  await writeFile(join(source, "index.ts"), "export const value = 100;\n");
  await writeFile(join(source, "index.test.ts"), 'test("value", () => {});\n');
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      scripts: { test: "vitest" },
      dependencies: { example: "1.0.0" },
    }),
  );
  await writeFile(join(source, "package-lock.json"), "{}");
  await writeFile(join(source, ".gitignore"), "node_modules/\ndist/\n");
  await exec("git", ["init", "-q", source]);
  await exec("git", ["-C", source, "add", "."]);
  await exec("git", [
    "-C",
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  const { stdout } = await exec("git", ["-C", source, "rev-parse", "HEAD"]);
  return { root, source, commit: stdout.trim() };
}
