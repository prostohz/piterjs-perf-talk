import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Target } from "../../src/target.js";
import { command, directory } from "./harness/command.js";
import { scenarios } from "./harness/fixtures.js";

export default {
  scenarios,
  async prepare(libraryPath) {
    if (Number(process.versions.node.split(".")[0]) < 26)
      throw new Error("SVGEdit target requires Node.js >=26");
    const library = await realpath(libraryPath);
    if (
      (await readFile(join(library, "package-lock.json"), "utf8")) !==
      (await readFile(join(directory, "library-package-lock.json"), "utf8"))
    )
      throw new Error(
        "Library lockfile differs from the pinned target lockfile",
      );
    await command(
      "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      directory,
    );
    await command("npm", ["ci", "--no-audit", "--no-fund"], library);
    await command("npm", ["run", "build"], library);
    await command(
      process.execPath,
      [
        join(directory, "node_modules/playwright/cli.js"),
        "install",
        "chromium",
      ],
      directory,
    );
    const { createSession } = await import("./harness/session.js");
    return createSession(library);
  },
} satisfies Target;
