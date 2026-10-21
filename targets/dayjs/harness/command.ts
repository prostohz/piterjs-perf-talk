import { spawn } from "node:child_process";
import { dirname } from "node:path";

export function command(
  program: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
        CI: "1",
        TZ: "UTC",
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--openssl-legacy-provider"]
          .filter(Boolean)
          .join(" "),
        HUSKY: "0",
      },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${program} ${args.join(" ")} failed (${signal ?? code})`),
        );
    });
  });
}
