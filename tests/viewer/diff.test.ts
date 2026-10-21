import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReport, type Attempt } from "../../src/pipeline/report.js";
import { readAttemptDiff, readRunDiff } from "../../src/viewer/diff.js";
import { diffLineCounts } from "../../src/viewer/model.js";
import { settings } from "../config.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "viewer-diff-"));
  roots.push(root);
  const directory = join(root, "one", "run");
  const report = createReport("one", settings(), new Date(), {});
  const attempts: Attempt[] = [
    {
      id: "baseline",
      parent: null,
      status: "accepted",
      stage: "done",
      measurements: {},
      errors: [],
    },
    {
      id: "iteration-001",
      parent: "baseline",
      status: "rejected",
      stage: "done",
      measurements: {},
      errors: [],
    },
    {
      id: "iteration-002",
      parent: "baseline",
      status: "accepted",
      stage: "done",
      measurements: {},
      errors: [],
    },
  ];
  report.attempts = attempts;
  report.best = "iteration-002";
  for (const attempt of attempts) {
    const library = join(directory, attempt.id, "library");
    await mkdir(join(library, "src"), { recursive: true });
    await writeFile(
      join(library, "src", "index.js"),
      "export const value = 1;\n",
    );
  }
  const save = () =>
    writeFile(join(directory, "report.json"), JSON.stringify(report));
  await save();
  const library = (id: string) => join(directory, id, "library");
  const read = (id = "iteration-002") =>
    readAttemptDiff(root, "one", "run", id);
  return { root, directory, report, save, library, read };
}

it("diffs against the recorded parent, including added, deleted and binary files", async () => {
  const f = await fixture();
  await writeFile(
    join(f.library("iteration-001"), "src/index.js"),
    "rejected change\n",
  );
  await writeFile(
    join(f.library("iteration-002"), "src/index.js"),
    "export const value = 2;\n",
  );
  await writeFile(join(f.library("baseline"), "removed.js"), "removed\n");
  await writeFile(join(f.library("iteration-002"), "added file.js"), "added\n");
  await writeFile(
    join(f.library("iteration-002"), "binary.dat"),
    Buffer.from([0, 1, 2]),
  );
  const result = await f.read();
  expect(result.parent).toBe("baseline");
  expect(result.patch).toContain("-export const value = 1;");
  expect(result.patch).toContain("+export const value = 2;");
  expect(result.patch).toContain("+added");
  expect(result.patch).toContain("-removed");
  expect(result.patch).toContain("Binary files");
  expect(result.patch).not.toContain("rejected change");
  expect(result.patch).not.toContain(f.root);
  expect((await f.read("iteration-001")).patch).toContain("+rejected change");
});

it("handles baseline and identical snapshots without reporting an error", async () => {
  const f = await fixture();
  expect(await f.read("baseline")).toEqual({ parent: null, patch: "" });
  expect(await f.read()).toEqual({ parent: "baseline", patch: "" });
});

it("compares the final accepted snapshot with baseline across all iterations", async () => {
  const f = await fixture();
  f.report.attempts[1]!.status = "accepted";
  f.report.attempts[2]!.parent = "iteration-001";
  await writeFile(
    join(f.library("baseline"), "src/index.js"),
    "original\nkept\n",
  );
  await writeFile(
    join(f.library("iteration-001"), "src/index.js"),
    "first\nkept\n",
  );
  await writeFile(
    join(f.library("iteration-002"), "src/index.js"),
    "first\nfinal\n",
  );
  f.report.attempts.push({
    ...f.report.attempts[2]!,
    id: "iteration-003",
    parent: "iteration-002",
    status: "rejected",
  });
  await mkdir(f.library("iteration-003"), { recursive: true });
  await writeFile(
    join(f.library("iteration-003"), "rejected.js"),
    "rejected\n",
  );
  await f.save();
  const result = await readRunDiff(f.root, "one", "run");
  expect(result.parent).toBe("baseline");
  expect(result.patch).toContain("-original");
  expect(result.patch).toContain("+first");
  expect(result.patch).toContain("+final");
  expect(result.patch).not.toContain("rejected");
  expect(diffLineCounts(result.patch)).toEqual({ added: 2, removed: 2 });
  expect((await f.read()).patch).not.toContain("+first");
});

it("returns an empty final diff when baseline remains best and rejects absent results", async () => {
  const f = await fixture();
  f.report.best = "baseline";
  await f.save();
  expect(await readRunDiff(f.root, "one", "run")).toEqual({
    parent: "baseline",
    patch: "",
  });
  f.report.best = null;
  await f.save();
  await expect(readRunDiff(f.root, "one", "run")).rejects.toThrow(
    "Принятой версии пока нет",
  );
});

it("counts only hunk lines, including lines resembling diff headers", () => {
  const patch = [
    "diff --git a/file b/file",
    "--- a/file",
    "+++ b/file",
    "@@ -1,2 +1,3 @@",
    "---removed",
    "+++added",
    "+",
    " context",
    "\\ No newline at end of file",
    "diff --git a/binary b/binary",
    "Binary files a/binary and b/binary differ",
  ].join("\n");
  expect(diffLineCounts(patch)).toEqual({ added: 2, removed: 1 });
  expect(diffLineCounts("")).toEqual({ added: 0, removed: 0 });
});

it("rejects missing snapshots and waits for a running attempt to finish", async () => {
  const f = await fixture();
  f.report.attempts[2]!.status = "running";
  await f.save();
  await expect(f.read()).rejects.toThrow("после завершения");
  f.report.attempts[2]!.status = "interrupted";
  await f.save();
  expect((await f.read()).patch).toBe("");
  await rm(f.library("iteration-002"), { recursive: true });
  await expect(f.read()).rejects.toThrow();
});

it("rejects traversal, snapshot symlinks and symlinks inside source trees", async () => {
  const f = await fixture();
  await expect(f.read("../../outside")).rejects.toThrow("не найдена");
  await expect(
    readAttemptDiff(f.root, "..", "run", "baseline"),
  ).rejects.toThrow("путь");
  await symlink(
    join(f.directory, "report.json"),
    join(f.library("iteration-002"), "src/link"),
  );
  await expect(f.read()).rejects.toThrow("Symlinks");
  await rm(f.library("iteration-002"), { recursive: true });
  await symlink(f.root, f.library("iteration-002"));
  await expect(f.read()).rejects.toThrow("Путь вне");
});
