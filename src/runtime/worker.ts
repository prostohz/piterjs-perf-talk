import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgent } from "../agents/createAgent.js";
import { libraryProvenance, loadTarget } from "../target.js";
import { executePipeline } from "../pipeline/run.js";
import {
  assertUnchanged,
  fixedFilesIntegrity,
  manifest,
} from "../pipeline/integrity.js";
import { failReport, RunHistory } from "../pipeline/report.js";
import { errorMessage } from "./errors.js";

async function execute(
  directory: string,
  root: string,
  signal: AbortSignal,
): Promise<number> {
  const history = await RunHistory.load(directory);
  const { report } = history;

  try {
    const targetDirectory = join(root, "targets", report.target);
    const source = join(targetDirectory, "library");
    const declaration = JSON.parse(
      await readFile(join(targetDirectory, "source.json"), "utf8"),
    ) as unknown;
    const provenance = await libraryProvenance(source, declaration);

    const agent = createAgent(report.config.agent);
    const agentVersion = await agent.version();
    const targetFiles = await manifest(targetDirectory, true);
    if (report.attempts.length) {
      const previous = report.environment.targetFiles;
      if (!previous || typeof previous !== "object" || Array.isArray(previous))
        throw new Error("Run has no target fingerprint; start a new run");
      assertUnchanged(
        previous as Record<string, string>,
        targetFiles,
        "Target",
      );
      if (report.environment.agentVersion !== agentVersion)
        throw new Error("Agent version changed; start a new run");
      if (
        JSON.stringify(report.environment.source) !== JSON.stringify(provenance)
      )
        throw new Error("Library provenance changed; start a new run");
    } else {
      report.environment.source = provenance;
      report.environment.agentVersion = agentVersion;
      report.environment.targetFiles = targetFiles;
    }
    await history.save();
    const checkIntegrity = await fixedFilesIntegrity(targetDirectory);

    await executePipeline({
      directory,
      source,
      report,
      loadTarget: () => loadTarget(targetDirectory),
      agent,
      signal,
      checkIntegrity,
    });
  } catch (error) {
    failReport(report, errorMessage(error), signal.aborted);
    await history.save();
  }

  return report.status === "completed" ? 0 : 1;
}

async function main(): Promise<number> {
  const [directory, root] = process.argv.slice(2);
  if (!directory || !root)
    throw new Error("Worker requires run and project directories");

  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Run interrupted"));
  const keepAlive = setInterval(() => {}, 60_000);
  process.on("SIGTERM", interrupt);
  process.on("SIGINT", interrupt);

  try {
    return await execute(directory, root, controller.signal);
  } finally {
    clearInterval(keepAlive);
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
  }
}

process.exit(await main());
