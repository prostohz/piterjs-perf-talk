import { afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executePipeline } from "../../src/pipeline/run.js";
import { createReport } from "../../src/pipeline/report.js";
import type { CodingAgent } from "../../src/agents/types.js";
import type { Target } from "../../src/target.js";
import { fixture } from "./snapshots.fixture.js";
import { settings } from "../config.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

export async function setup() {
  const f = await fixture();
  roots.push(f.root);
  const directory = join(f.root, "run");
  await mkdir(directory);
  const config = settings();
  const report = createReport("fixture", config, new Date(), {});
  const controller = new AbortController();
  const target: Target = {
    scenarios: ["one", "two"],
    async prepare(path) {
      const source = await readFile(join(path, "index.ts"), "utf8");
      const value = Number(source.match(/\d+/)![0]);
      await writeFile(join(path, "generated.js"), "generated");
      return {
        async test() {},
        async measure() {
          return { operationTimeMs: value };
        },
        async close() {},
      };
    },
  };
  return { ...f, directory, report, target, controller };
}

export function execute(
  f: Awaited<ReturnType<typeof setup>>,
  agent: Pick<CodingAgent, "run">,
) {
  return executePipeline({
    directory: f.directory,
    source: f.source,
    report: f.report,
    loadTarget: async () => f.target,
    agent: {
      ...agent,
      async version() {
        return "fake-agent 1.0";
      },
    },
    signal: f.controller.signal,
    checkIntegrity: async () => {},
  });
}
