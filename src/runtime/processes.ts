import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function descendants(root: number): Promise<number[]> {
  const { stdout } = await promisify(execFile)(
    "ps",
    ["-A", "-o", "pid=,ppid="],
    {
      timeout: 1000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const found = new Set([root]);
  let previous: number;
  do {
    previous = found.size;
    for (const [pid, parent] of rows)
      if (pid && parent && found.has(parent)) found.add(pid);
  } while (found.size !== previous);
  found.delete(root);
  return [...found].reverse();
}

export function sendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
