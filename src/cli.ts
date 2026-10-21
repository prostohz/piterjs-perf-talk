import { validateExtension } from "./runtime/resume.js";
import type { Config } from "./config.js";

export const usage =
  "Usage: npm run pipeline -- <target>\n       npm run pipeline -- resume <target>/<run-id> --minutes 60 --iterations 10";

type Command =
  | { type: "help" }
  | { type: "run"; target: string }
  | { type: "resume"; path: string; budgets: Config["budgets"] };

export function parseArgs(args: string[]): Command {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!))
    return { type: "help" };
  if (args.length === 1 && args[0] !== "resume")
    return { type: "run", target: args[0]! };
  if (args[0] !== "resume" || args.length !== 6) throw new Error(usage);
  const flags = new Map<string, number>();
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index]!;
    const value = args[index + 1]!;
    if (
      !["--minutes", "--iterations"].includes(flag) ||
      flags.has(flag) ||
      !/^(?:\d+\.?\d*|\.\d+)$/.test(value)
    )
      throw new Error(usage);
    flags.set(flag, Number(value));
  }
  const budgets = {
    maxDurationMinutes: flags.get("--minutes")!,
    maxIterations: flags.get("--iterations")!,
  };
  validateExtension(budgets);
  return { type: "resume", path: args[1]!, budgets };
}
