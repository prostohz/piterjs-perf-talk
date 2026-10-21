import { run, resume } from "./runtime/supervisor.js";
import { loadConfig } from "./config.js";
import { errorMessage } from "./runtime/errors.js";
import { parseArgs, usage } from "./cli.js";

const startedAt = new Date();
const controller = new AbortController();
const interrupt = () => controller.abort(new Error("Interrupted by user"));
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  const command = parseArgs(process.argv.slice(2));
  if (command.type === "help") {
    console.log(usage);
  } else {
    const root = process.cwd();
    const { directory, report } =
      command.type === "resume"
        ? await resume(
            root,
            command.path,
            command.budgets,
            controller.signal,
            startedAt,
          )
        : await run(
            root,
            command.target,
            await loadConfig(root),
            controller.signal,
            startedAt,
          );
    console.log(`${report.status}: ${directory}\n${report.stopReason}`);
    if (report.status !== "completed")
      process.exitCode = report.status === "interrupted" ? 130 : 1;
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
