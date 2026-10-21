import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTarget } from "../src/target.js";

it("rejects invalid targets when loading target.ts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-target-"));
  try {
    await writeFile(
      join(directory, "target.ts"),
      "export default { scenarios: [], async prepare() {} };",
    );
    await expect(loadTarget(directory)).rejects.toThrow(
      "Target must define scenarios",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
