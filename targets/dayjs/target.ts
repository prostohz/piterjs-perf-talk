import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Target } from "../../src/target.js";
import { command } from "./harness/command.js";
import { scenarios } from "./harness/fixtures.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const harness = join(directory, "harness");

export default {
  scenarios,
  async prepare(libraryPath) {
    const library = await realpath(libraryPath);
    const frozenLock = await readFile(
      join(harness, "library-package-lock.json"),
      "utf8",
    );
    if (
      (await readFile(join(library, "package-lock.json"), "utf8")) !==
      frozenLock
    )
      throw new Error(
        "Library lockfile differs from the pinned target lockfile",
      );
    await command(
      "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      library,
    );
    await command("npm", ["run", "build"], library);
    await command(
      "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      harness,
    );
    await command(
      process.execPath,
      [join(harness, "node_modules/playwright/cli.js"), "install", "chromium"],
      harness,
    );
    const { createSession } = await import("./harness/session.js");
    return createSession(library);
  },
} satisfies Target;
