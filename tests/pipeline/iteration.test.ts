import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "../../src/pipeline/snapshots.js";
import { setup, execute } from "./run.fixture.js";

describe("iteration", () => {
  it.each(["build", "test"])(
    "repairs a %s failure in one agent session before measuring",
    async (failure) => {
      const f = await setup();
      f.report.config.budgets.maxIterations = 1;
      let prepared = 0;
      let closed = 0;
      let agentRuns = 0;
      let candidateMeasurements = 0;
      let candidateTests = 0;
      let agentFinished = false;
      const prepare = f.target.prepare;
      f.target.prepare = async (path) => {
        const attempt = ++prepared;
        if (attempt === 2 && failure === "build")
          throw new Error("Build failed");
        const session = await prepare(path);
        return {
          ...session,
          async test() {
            if (attempt > 1) {
              candidateTests++;
              expect(agentFinished).toBe(false);
            }
            if (attempt === 2) throw new Error("Test failed");
          },
          async measure() {
            if (attempt > 1) {
              expect(agentFinished).toBe(true);
              candidateMeasurements++;
            }
            return session.measure("one", "operationTimeMs");
          },
          async close() {
            closed++;
          },
        };
      };
      await execute(f, {
        async run(request) {
          agentRuns++;
          expect(request.outputDirectory).toBe(
            join(f.directory, "iteration-001/agent"),
          );
          const verify = request.tools[0]!;
          await writeFile(
            join(request.cwd, "index.ts"),
            "export const value = 80;",
          );
          expect(await verify.execute({})).toMatchObject({
            success: false,
            text: expect.stringContaining(
              failure === "build" ? "Build failed" : "Test failed",
            ),
          });
          expect(candidateMeasurements).toBe(0);
          expect(await exists(join(request.cwd, "generated.js"))).toBe(false);
          await writeFile(
            join(request.cwd, "index.ts"),
            "export const value = 70;",
          );
          expect(await verify.execute({})).toMatchObject({ success: true });
          expect(candidateMeasurements).toBe(0);
          agentFinished = true;
          return { hypothesis: "Reduce work" };
        },
      });
      expect(f.report.status, f.report.stopReason).toBe("completed");
      expect(agentRuns).toBe(1);
      expect(prepared).toBe(4);
      expect(closed).toBe(failure === "build" ? 3 : 4);
      expect(candidateTests).toBe(failure === "build" ? 1 : 2);
      expect(candidateMeasurements).toBe(6);
      expect(f.report.attempts).toHaveLength(2);
      expect(f.report.attempts[1]!.status, f.report.stopReason).toBe(
        "accepted",
      );
      expect(f.report.attempts[1]!.errors).toHaveLength(1);
    },
  );

  it.each([
    "package.json",
    "package-lock.json",
    "index.test.ts",
    "vitest.config.ts",
  ])("rejects forbidden changes to %s", async (file) => {
    const f = await setup();
    await execute(f, {
      async run({ cwd: libraryPath }) {
        await writeFile(join(libraryPath, file), "changed");
        return { hypothesis: "Invalid" };
      },
    });
    expect(f.report.status).toBe("failed");
    expect(f.report.stopReason).toContain("Protected files changed");
    expect(f.report.best).toBe("baseline");
  });
});
