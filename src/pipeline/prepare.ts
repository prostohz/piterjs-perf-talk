import { validateSession, type TargetSession } from "../target.js";
import { errorMessage } from "../runtime/errors.js";
import { preserveSource, restoreSource } from "./snapshots.js";
import type { AttemptContext } from "./report.js";
import type { EvaluationContext } from "./evaluate.js";

export class VerificationError extends Error {}

export async function testLibrary(
  session: TargetSession,
  context: EvaluationContext,
): Promise<void> {
  try {
    await context.budget.within(() => session.test());
  } catch (error) {
    throw new VerificationError(errorMessage(error));
  }
}

export async function withPreparedSnapshot(
  attempt: AttemptContext,
  context: EvaluationContext,
  operation: (session: TargetSession) => Promise<void>,
): Promise<void> {
  await preserveSource(attempt.paths);

  try {
    let prepared: TargetSession;
    try {
      prepared = await context.budget.within(() =>
        context.target.prepare(attempt.paths.library),
      );
    } catch (error) {
      throw new VerificationError(errorMessage(error));
    }

    const session = validateSession(prepared);
    try {
      await operation(session);
    } finally {
      await session.close();
    }
  } finally {
    if (!context.budget.interrupted) await restoreSource(attempt.paths);
  }

  context.budget.check();
  await context.checkIntegrity();
}
