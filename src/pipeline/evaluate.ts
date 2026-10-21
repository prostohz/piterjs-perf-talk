import type { Config } from "../config.js";
import type { Target } from "../target.js";
import type { Budget } from "../runtime/budget.js";
import { addMeasurement } from "./metrics.js";
import { testLibrary, withPreparedSnapshot } from "./prepare.js";
import type { AttemptContext, RunHistory } from "./report.js";

export interface EvaluationContext {
  config: Config;
  target: Target;
  budget: Budget;
  history: RunHistory;
  checkIntegrity(): Promise<void>;
}

export async function evaluate(
  attempt: AttemptContext,
  context: EvaluationContext,
): Promise<void> {
  const { budget, history, target, config } = context;
  budget.check();
  await history.stage(attempt, "prepare");

  await withPreparedSnapshot(attempt, context, async (session) => {
    if (attempt.record.parent === null) {
      await history.stage(attempt, "test");
      await testLibrary(session, context);
    }

    budget.check();
    await history.stage(attempt, "measure");
    for (const scenario of target.scenarios) {
      for (let repeat = 0; repeat < config.measurements.repeats; repeat++) {
        const values = await budget.within(() =>
          session.measure(scenario, config.targetMetric),
        );
        addMeasurement(attempt.record.measurements, scenario, values, config);
        await history.save();
      }
    }
  });
}
