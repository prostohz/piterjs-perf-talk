import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../src/runtime/supervisor.js";
import { exists } from "../../src/pipeline/snapshots.js";
import { settings } from "../config.fixture.js";
import { fixture } from "../pipeline/snapshots.fixture.js";
import { roots, project, normalTarget } from "./supervisor.fixture.js";

describe("supervisor", () => {
  it("runs a full cycle through the real adapter with a local fake Codex process", async () => {
    const root = await project(normalTarget);
    const result = await run(
      root,
      "fixture",
      settings({
        budgets: { maxDurationMinutes: 1, maxIterations: 1 },
      }),
    );
    expect(result.report.status, result.report.stopReason).toBe("completed");
    expect(result.report.best).toBe("iteration-001");
    expect(result.report.environment.agentVersion).toBe("fake-codex 1.0");
    expect(
      await exists(
        join(result.directory, "iteration-001/library/generated.js"),
      ),
    ).toBe(false);
    expect(
      JSON.parse(
        await readFile(
          join(result.directory, "iteration-001/agent/response.json"),
          "utf8",
        ),
      ),
    ).toEqual({ hypothesis: "Reduce work" });
    expect(
      await readFile(
        join(result.directory, "iteration-001/agent/prompt.txt"),
        "utf8",
      ),
    ).toContain("Do not change, remove, disable");
  });

  it("enforces the deadline on a blocked worker and kills its child processes", async () => {
    const root = await project(
      `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default {
  scenarios: ['blocked'],
  async prepare(path) {
    writeFileSync(join(path, 'generated.js'), 'temporary');
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
    writeFileSync(join(${JSON.stringify("__ROOT__")}, 'child.pid'), String(child.pid));
    while (true) {}
  }
};
`.replace(JSON.stringify("__ROOT__"), "process.cwd()"),
    );
    const started = Date.now();
    const result = await run(
      root,
      "fixture",
      settings({
        budgets: { maxDurationMinutes: 0.04, maxIterations: 1 },
      }),
    );
    expect(Date.now() - started).toBeLessThan(6000);
    expect(result.report.status).toBe("interrupted");
    expect(result.report.attempts[0]!.status).toBe("interrupted");
    expect(result.report.best).toBeNull();
    expect(
      await exists(join(result.directory, "baseline/library/generated.js")),
    ).toBe(false);
    expect(
      await readFile(
        join(result.directory, "baseline/library/index.ts"),
        "utf8",
      ),
    ).toContain("100");
    const pid = Number(await readFile(join(root, "child.pid"), "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
      timeout: 2000,
    });
  }, 10_000);

  it("cancels asynchronous measurement, closes the session and retains partial samples", async () => {
    const root = await project(`
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
let calls = 0;
export default {
  scenarios: ['operation'],
  async prepare() {
    return {
      async test() {},
      async measure() {
        if (++calls === 1) return { operationTimeMs: 100 };
        await writeFile(join(process.cwd(), 'waiting'), 'yes');
        await new Promise(() => {});
      },
      async close() { await writeFile(join(process.cwd(), 'closed'), 'yes'); }
    };
  }
};
`);
    const controller = new AbortController();
    const pending = run(root, "fixture", settings(), controller.signal);
    await vi.waitFor(
      async () => expect(await exists(join(root, "waiting"))).toBe(true),
      { timeout: 5000 },
    );
    controller.abort();
    const result = await pending;
    expect(result.report.status).toBe("interrupted");
    expect(
      result.report.attempts[0]!.measurements.operation!.operationTimeMs!
        .samples,
    ).toEqual([100]);
    expect(await exists(join(root, "closed"))).toBe(true);
    expect(result.report.best).toBeNull();
  });

  it("reports a missing target without creating one", async () => {
    const f = await fixture();
    roots.push(f.root);
    await expect(run(f.root, "missing", settings())).rejects.toThrow(
      "Target not found",
    );
    expect(await exists(join(f.root, "targets"))).toBe(false);
    await expect(run(f.root, "../escape", settings())).rejects.toThrow(
      "Invalid target",
    );
  });
});

it("repairs failed library tests through one Codex thread and turn", async () => {
  const root = await project(
    normalTarget.replace(
      "async test() {}",
      "async test() { if (value === 80) throw new Error('Library test failed'); }",
    ),
  );
  const result = await run(
    root,
    "fixture",
    settings({
      budgets: { maxDurationMinutes: 1, maxIterations: 1 },
    }),
  );
  expect(result.report.status, result.report.stopReason).toBe("completed");
  expect(result.report.best).toBe("iteration-001");
  expect(result.report.attempts[1]!.errors).toHaveLength(1);
  expect(
    await readFile(
      join(result.directory, "iteration-001/library/index.ts"),
      "utf8",
    ),
  ).toContain("70");
  const messages = (await readFile(join(root, "rpc.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(
    messages.filter((message) => message.method === "initialize"),
  ).toHaveLength(1);
  expect(
    messages.filter((message) => message.method === "thread/start"),
  ).toHaveLength(1);
  expect(
    messages.filter((message) => message.method === "turn/start"),
  ).toHaveLength(1);
  const replies = messages.filter((message) =>
    String(message.id).startsWith("tool-"),
  );
  expect(replies.map((message) => message.result.success)).toEqual([
    false,
    true,
  ]);
  expect(replies[0].result.contentItems[0].text).toContain(
    "Library test failed",
  );
  expect(await exists(join(result.directory, "iteration-001/agent-0"))).toBe(
    false,
  );
  expect(
    await readFile(
      join(result.directory, "iteration-001/agent/requests.jsonl"),
      "utf8",
    ),
  ).toContain("Library test failed");
});

it("cancels verification in a live agent session and restores the source", async () => {
  const root = await project(
    normalTarget
      .replace(
        "async test() {}",
        `async test() {
    if (value !== 100) {
      await writeFile(join(process.cwd(), 'verifying'), 'yes');
      await new Promise(() => {});
    }
  }`,
      )
      .replace(
        "async close() {}",
        "async close() { await writeFile(join(process.cwd(), 'closed'), 'yes'); }",
      ),
  );
  const controller = new AbortController();
  const pending = run(root, "fixture", settings(), controller.signal);
  await vi.waitFor(
    async () => expect(await exists(join(root, "verifying"))).toBe(true),
    { timeout: 5000 },
  );
  controller.abort();
  const result = await pending;
  expect(result.report.status).toBe("interrupted");
  expect(result.report.best).toBe("baseline");
  expect(result.report.attempts[1]!.measurements).toEqual({});
  expect(
    await readFile(
      join(result.directory, "iteration-001/library/index.ts"),
      "utf8",
    ),
  ).toContain("80");
  expect(
    await exists(join(result.directory, "iteration-001/library/generated.js")),
  ).toBe(false);
});
