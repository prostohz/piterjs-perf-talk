import { join } from "node:path";
import type { CodingAgent } from "../agents/types.js";
import { evaluate, type EvaluationContext } from "./evaluate.js";
import type { Manifest } from "./integrity.js";
import { createVerification } from "./verification.js";
import { compare, type Measurements } from "./metrics.js";
import { createPrompt, hypothesisSchema, readHypothesis } from "./prompt.js";
import type { AttemptContext } from "./report.js";
import { copySnapshot } from "./snapshots.js";

export interface IterationContext extends EvaluationContext {
  agent: CodingAgent;
  original: Manifest;
  baseline: Measurements;
}

async function edit(
  attempt: AttemptContext,
  context: IterationContext,
): Promise<void> {
  const { agent, budget, config, history, target, original } = context;
  const { record, paths } = attempt;
  budget.check();
  await history.stage(attempt, "agent");
  const verification = createVerification(attempt, context, original);

  const response = await budget.within(() =>
    agent.run({
      cwd: paths.library,
      outputDirectory: join(paths.directory, "agent"),
      settings: config.agent,
      prompt: createPrompt(config, target.scenarios, history.report.attempts),
      responseSchema: hypothesisSchema,
      signal: budget.signal,
      tools: [verification.tool],
    }),
  );

  const hypothesis = readHypothesis(response);
  record.hypothesis = hypothesis;
  await history.save();

  await verification.assertVerified();
}

export async function executeIteration(
  reference: AttemptContext,
  index: number,
  context: IterationContext,
): Promise<AttemptContext> {
  const { budget, history, config, target } = context;
  budget.check();

  const attempt = await history.startAttempt(
    `iteration-${String(index).padStart(3, "0")}`,
    reference.record.id,
  );
  await budget.within(() =>
    copySnapshot(reference.paths.library, attempt.paths.library),
  );
  await edit(attempt, context);

  await evaluate(attempt, context);

  budget.check();
  const { candidateCost, ...decision } = compare(
    context.baseline,
    reference.record.measurements,
    attempt.record.measurements,
    target.scenarios,
    config,
  );
  attempt.record.cost = candidateCost;
  await history.completeAttempt(attempt, decision);
  return attempt;
}
