import {
  validateMeasurementWorker,
  type MeasurementWorker,
  type TargetSession,
} from "../target.js";
import type { EvaluationContext } from "./evaluate.js";
import type { AttemptContext } from "./report.js";
import { addMeasurement } from "./metrics.js";

export async function measureScenarios(
  session: TargetSession,
  attempt: AttemptContext,
  context: EvaluationContext,
): Promise<void> {
  const { config, target, budget, history } = context;
  const count = Math.min(
    config.measurements.workers ?? 1,
    target.scenarios.length,
  );
  if (count > 1 && !session.createWorker)
    throw new Error("Target does not support parallel measurement workers");
  const workers: MeasurementWorker[] = [session];
  let cursor = 0;
  let stopped = false;
  let saves = Promise.resolve();
  let closing: Promise<PromiseSettledResult<void>[]> | undefined;
  let failure: { error: unknown } | undefined;
  const stop = (error: unknown) => {
    if (failure) return;
    failure = { error };
    stopped = true;
    closing = Promise.allSettled(workers.map((worker) => worker.close()));
  };
  try {
    while (workers.length < count) {
      const worker = await budget.within(() => session.createWorker!());
      workers.push(validateMeasurementWorker(worker));
    }
    await Promise.allSettled(
      workers.map(async (worker, index) => {
        try {
          while (!stopped) {
            const scenario = target.scenarios[cursor++];
            if (scenario === undefined) return;
            await history.measurementEvent(
              attempt,
              index + 1,
              scenario,
              "start",
            );
            for (
              let repeat = 0;
              repeat < config.measurements.repeats;
              repeat++
            ) {
              if (stopped) return;
              const values = await budget.within(() =>
                worker.measure(scenario, config.targetMetric),
              );
              if (stopped) return;
              addMeasurement(
                attempt.record.measurements,
                scenario,
                values,
                config,
              );
              saves = saves.then(() => history.save());
              await saves;
            }
            await history.measurementEvent(
              attempt,
              index + 1,
              scenario,
              "done",
            );
          }
        } catch (error) {
          stop(error);
        }
      }),
    );
  } catch (error) {
    failure ??= { error };
  } finally {
    const closed = await (closing ??
      Promise.allSettled(workers.slice(1).map((worker) => worker.close())));
    if (!failure) {
      const rejected = closed.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") failure = { error: rejected.reason };
    }
  }
  if (failure) throw failure.error;
}
