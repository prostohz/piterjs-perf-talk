import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { copyLibrary } from "../../../src/pipeline/snapshots.js";
import { libraryProvenance } from "../../../src/target.js";
import { command } from "./command.js";
import { bundle } from "./session.js";
import { freezeDate } from "./clock.js";
import { records } from "./fixtures.js";

const target = fileURLToPath(new URL("../", import.meta.url));
const declaration = JSON.parse(
  await readFile(join(target, "source.json"), "utf8"),
);
await libraryProvenance(join(target, "library"), declaration);
const temporary = await mkdtemp(join(tmpdir(), "dayjs-oracle-"));
try {
  const library = join(await realpath(temporary), "library");
  await copyLibrary(join(target, "library"), library);
  await command(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    library,
  );
  await command("npm", ["run", "build"], library);
  const { code } = await bundle(library, "capture.ts");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    await freezeDate(page);
    await page.goto("about:blank");
    await page.addScriptTag({ content: Buffer.from(code).toString() });
    const results = await page.evaluate(() => window.captureDayjs());
    assert.deepEqual(
      results["format-table"],
      records.map(({ iso }) => iso.slice(0, 19).replace("T", " ") + " UTC"),
    );
    assert.deepEqual(
      results["parse-timestamps"],
      records.map(
        ({ iso, timestamp }) => `${iso}|${Math.floor(timestamp / 1000)}`,
      ),
    );
    assert.deepEqual(
      results["parse-custom-strict"],
      records.map(({ iso }, index) => (index % 7 === 0 ? "invalid" : iso)),
    );
    assert.deepEqual(
      results["filter-date-range"],
      records
        .filter(
          ({ timestamp }) =>
            timestamp >= Date.UTC(2024, 0, 1) &&
            timestamp < Date.UTC(2024, 6, 1),
        )
        .map(({ iso }) => iso),
    );
    const scenarios = Object.fromEntries(
      Object.entries(results).map(([name, rows]) => [
        name,
        {
          count: rows.length,
          sha256: createHash("sha256")
            .update(JSON.stringify(rows))
            .digest("hex"),
        },
      ]),
    );
    await writeFile(
      join(target, "harness/expected.json"),
      JSON.stringify({ commit: declaration.commit, scenarios }, null, 2) + "\n",
    );
    console.log("Frozen", Object.keys(scenarios).length, "scenarios");
  } finally {
    await browser.close();
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
