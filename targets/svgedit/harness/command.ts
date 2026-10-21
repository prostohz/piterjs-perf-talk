import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const directory = fileURLToPath(new URL(".", import.meta.url));
export const browserCache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  join(
    homedir(),
    process.platform === "darwin"
      ? "Library/Caches/ms-playwright"
      : ".cache/ms-playwright",
  );

export function command(
  program: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      CI: "1",
      TZ: "UTC",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --no-experimental-webstorage`,
      PLAYWRIGHT_BROWSERS_PATH: browserCache,
      FORCE_COLOR: "0",
    };
    delete env.COVERAGE;
    delete env.NODE_ENV;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(program, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(output);
      else
        reject(
          new Error(`${program} ${args.join(" ")} failed (${signal ?? code})`),
        );
    });
  });
}
