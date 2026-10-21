import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexAgent } from "../../../src/agents/codex/index.js";
import { run } from "../../../src/runtime/supervisor.js";
import { settings } from "../../config.fixture.js";
import { project, normalTarget } from "../../runtime/supervisor.fixture.js";

it("stops when Codex reports failure even with exit code zero", async () => {
  const root = await project(normalTarget, "failure");
  const result = await run(root, "fixture", settings());
  expect(result.report.status).toBe("failed");
  expect(result.report.stopReason).toContain("Codex did not complete");
  expect(result.report.attempts).toHaveLength(2);
  expect(result.report.best).toBe("baseline");
});

it("passes through a caller-defined task and JSON response without pipeline assumptions", async () => {
  const root = await project(normalTarget, "success", { payload: [1, 2, 3] });
  const outputDirectory = join(root, "agent-output");
  const prompt = "Return the requested payload.";
  const schema = {
    type: "object",
    properties: { payload: { type: "array", items: { type: "number" } } },
    required: ["payload"],
    additionalProperties: false,
  };

  const response = await new CodexAgent().run({
    cwd: join(root, "targets/fixture/library"),
    outputDirectory,
    settings: settings().agent,
    prompt,
    responseSchema: schema,
    signal: new AbortController().signal,
    tools: [],
  });

  expect(response).toEqual({ payload: [1, 2, 3] });
  expect(await readFile(join(outputDirectory, "prompt.txt"), "utf8")).toBe(
    prompt,
  );
  expect(
    JSON.parse(
      await readFile(join(outputDirectory, "response.schema.json"), "utf8"),
    ),
  ).toEqual(schema);
});
