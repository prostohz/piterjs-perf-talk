import type { AgentTool } from "../agents/types.js";
import { errorMessage } from "../runtime/errors.js";
import type { EvaluationContext } from "./evaluate.js";
import {
  assertAllowedChanges,
  assertUnchanged,
  manifest,
  type Manifest,
} from "./integrity.js";
import {
  testLibrary,
  VerificationError,
  withPreparedSnapshot,
} from "./prepare.js";
import type { AttemptContext } from "./report.js";

export function createVerification(
  attempt: AttemptContext,
  context: EvaluationContext,
  original: Manifest,
): {
  tool: AgentTool;
  assertVerified(): Promise<void>;
} {
  let verified: Manifest | undefined;
  let running = false;
  let fatalError: unknown;

  const tool: AgentTool = {
    name: "verify_library",
    description:
      "Build the current library snapshot and run all its tests. On failure, fix the same hypothesis and call again. This does not measure performance. Do not edit files or start other commands while verification is running.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(argumentsValue) {
      if (running) throw new Error("Library verification is already running");
      if (fatalError) throw fatalError;
      running = true;
      verified = undefined;

      try {
        if (
          !argumentsValue ||
          typeof argumentsValue !== "object" ||
          Array.isArray(argumentsValue) ||
          Object.keys(argumentsValue).length
        )
          throw new Error("verify_library takes no arguments");
        context.budget.check();
        const sources = await manifest(attempt.paths.library);
        assertAllowedChanges(original, sources);
        await context.checkIntegrity();
        await context.history.stage(attempt, "agent:verify");

        try {
          await withPreparedSnapshot(attempt, context, (session) =>
            testLibrary(session, context),
          );
        } catch (error) {
          context.budget.check();
          if (!(error instanceof VerificationError)) throw error;
          const message = errorMessage(error);
          attempt.record.errors.push(message);
          await context.history.save();
          await context.history.stage(attempt, "agent");
          return { success: false, text: message };
        }

        assertUnchanged(
          sources,
          await manifest(attempt.paths.library),
          "Verified source",
        );
        verified = sources;
        await context.history.stage(attempt, "agent");
        return {
          success: true,
          text: "Build and all library tests passed. Any source edit requires another verify_library call before finishing.",
        };
      } catch (error) {
        fatalError = error;
        throw error;
      } finally {
        running = false;
      }
    },
  };

  return {
    tool,
    async assertVerified() {
      context.budget.check();
      if (fatalError) throw fatalError;
      const sources = await manifest(attempt.paths.library);
      assertAllowedChanges(original, sources);
      if (running || !verified)
        throw new Error(
          "Agent finished without a successful library verification",
        );
      assertUnchanged(verified, sources, "Source after verification");
      await context.checkIntegrity();
    },
  };
}
