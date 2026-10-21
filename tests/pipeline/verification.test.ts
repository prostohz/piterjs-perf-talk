import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setup, execute } from "./run.fixture.js";

describe("verification", () => {
  it.each(["skipped", "failed", "edited", "failed-again"])(
    "does not measure a candidate when verification was %s",
    async (mode) => {
      const f = await setup();
      let tests = 0;
      let measurements = 0;
      let agentRuns = 0;
      const prepare = f.target.prepare;
      f.target.prepare = async (path) => {
        const session = await prepare(path);
        return {
          ...session,
          async test() {
            if (++tests > (mode === "failed" ? 1 : 2))
              throw new Error("Test failed");
          },
          async measure(scenario, metric) {
            measurements++;
            return session.measure(scenario, metric);
          },
        };
      };
      await execute(f, {
        async run({ cwd, tools }) {
          agentRuns++;
          if (mode !== "skipped") await tools[0]!.execute({});
          if (mode === "edited")
            await writeFile(join(cwd, "index.ts"), "export const value = 80;");
          if (mode === "failed-again")
            expect(await tools[0]!.execute({})).toMatchObject({
              success: false,
            });
          return { hypothesis: "Reduce work" };
        },
      });
      expect(f.report.status).toBe("failed");
      expect(f.report.best).toBe("baseline");
      expect(f.report.stopReason).toContain(
        mode === "edited"
          ? "Source after verification"
          : "without a successful library verification",
      );
      expect(measurements).toBe(6);
      expect(agentRuns).toBe(1);
      expect(f.report.attempts[1]!.measurements).toEqual({});
    },
  );

  it("interrupts library tests without measuring or accepting the candidate", async () => {
    const f = await setup();
    const prepare = f.target.prepare;
    let tests = 0;
    let closed = 0;
    f.target.prepare = async (path) => {
      const session = await prepare(path);
      return {
        ...session,
        async test() {
          if (++tests === 2) {
            f.controller.abort(new Error("Cancelled"));
            await new Promise(() => {});
          }
        },
        async close() {
          closed++;
        },
      };
    };
    await execute(f, {
      async run({ tools }) {
        await tools[0]!.execute({});
        return { hypothesis: "unfinished" };
      },
    });
    expect(f.report.status).toBe("interrupted");
    expect(f.report.attempts[1]!.measurements).toEqual({});
    expect(f.report.best).toBe("baseline");
    expect(closed).toBe(2);
  });
});
