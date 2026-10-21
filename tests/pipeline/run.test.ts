import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "../../src/pipeline/snapshots.js";
import { manifest } from "../../src/pipeline/integrity.js";
import type { AgentRequest } from "../../src/agents/types.js";
import { setup, execute } from "./run.fixture.js";

describe("run", () => {
  it("starts from the last accepted snapshot and preserves rejected snapshots", async () => {
    const f = await setup();
    const starts: string[] = [];
    let index = 0;
    const before = await manifest(f.source, true);
    const result = await execute(f, {
      async run({ cwd: libraryPath, tools }) {
        starts.push(await readFile(join(libraryPath, "index.ts"), "utf8"));
        await writeFile(
          join(libraryPath, "index.ts"),
          `export const value = ${[90, 110, 80][index++]};\n`,
        );
        expect(await tools[0]!.execute({})).toMatchObject({ success: true });
        return { hypothesis: "Reduce work" };
      },
    });
    expect(result.status).toBe("completed");
    expect(result.attempts.map((a) => a.status)).toEqual([
      "accepted",
      "accepted",
      "rejected",
      "accepted",
    ]);
    expect(starts.map((s) => Number(s.match(/\d+/)![0]))).toEqual([
      100, 90, 90,
    ]);
    expect(result.best).toBe("iteration-003");
    const saved = JSON.parse(
      await readFile(join(f.directory, "report.json"), "utf8"),
    );
    expect(saved.attempts.map((a: { cost: number }) => a.cost)).toEqual([
      1, 0.9, 1.1, 0.8,
    ]);
    expect(saved.attempts[3].decision.referenceCost).toBe(0.9);
    expect(saved.attempts[3].decision.improvementPercent).toBeCloseTo(100 / 9);
    expect(
      await readFile(
        join(f.directory, "iteration-002/library/index.ts"),
        "utf8",
      ),
    ).toContain("110");
    expect(
      await exists(join(f.directory, "baseline/library/generated.js")),
    ).toBe(false);
    expect(await manifest(f.source, true)).toEqual(before);
    expect(
      result.attempts[0]!.measurements.one!.operationTimeMs!.samples,
    ).toHaveLength(3);
  });

  it("stops on an agent failure without retries and retains partial edits", async () => {
    const f = await setup();
    let edits = 0;
    await execute(f, {
      async run({ cwd: libraryPath }) {
        edits++;
        await writeFile(
          join(libraryPath, "partial.ts"),
          "export const partial = true;",
        );
        throw new Error("Agent failed");
      },
    });
    expect(edits).toBe(1);
    expect(f.report.attempts[1]!.status).toBe("failed");
    expect(
      await exists(join(f.directory, "iteration-001/library/partial.ts")),
    ).toBe(true);
    expect(f.report.best).toBe("baseline");
  });

  it("marks cancellation as interrupted and never accepts the candidate", async () => {
    const f = await setup();
    await execute(f, {
      async run(request: AgentRequest) {
        await writeFile(
          join(request.cwd, "partial.ts"),
          "export const partial = true;",
        );
        f.controller.abort(new Error("Cancelled"));
        return { hypothesis: "unfinished" };
      },
    });
    expect(f.report.status).toBe("interrupted");
    expect(f.report.attempts[1]!.status).toBe("interrupted");
    expect(f.report.best).toBe("baseline");
  });
});
