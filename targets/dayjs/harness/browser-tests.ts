import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";

export async function browserTests(browser: Browser, library: string) {
  const context = await browser.newContext({ timezoneId: "UTC" });
  try {
    const page = await context.newPage();
    await page.addScriptTag({
      content: await readFile(
        join(library, "node_modules/jasmine-core/lib/jasmine-core/jasmine.js"),
        "utf8",
      ),
    });
    await page.addScriptTag({
      content: `
      window.jasmine = jasmineRequire.core(jasmineRequire);
      const env = jasmine.getEnv();
      Object.assign(window, jasmineRequire.interface(jasmine, env));
      window.upstreamResult = { done: false, total: 0, failed: [] };
      env.addReporter({
        specDone(result) {
          window.upstreamResult.total++;
          if (result.status !== 'passed') window.upstreamResult.failed.push(result.fullName + ': ' + result.status + ' ' + JSON.stringify(result.failedExpectations));
        },
        jasmineDone(result) {
          window.upstreamResult.failed.push(...result.failedExpectations.map(expectation => expectation.message));
          window.upstreamResult.done = true;
        }
      });
    `,
    });
    await page.addScriptTag({
      content: await readFile(join(library, "dayjs.min.js"), "utf8"),
    });
    const specs = (await readdir(join(library, "test")))
      .filter((name) => name.endsWith("spec.js"))
      .sort();
    for (const spec of specs) {
      await page.addScriptTag({
        content: await readFile(join(library, "test", spec), "utf8"),
      });
    }
    await page.addScriptTag({ content: "jasmine.getEnv().execute();" });
    await page.waitForFunction(
      () =>
        (window as unknown as { upstreamResult: { done: boolean } })
          .upstreamResult.done,
    );
    const result = await page.evaluate(
      () =>
        (
          window as unknown as {
            upstreamResult: { total: number; failed: string[] };
          }
        ).upstreamResult,
    );
    if (!result.total || result.failed.length)
      throw new Error(
        `Upstream browser tests failed: ${JSON.stringify(result)}`,
      );
    console.log(`Upstream browser tests: ${result.total} passed`);
  } finally {
    await context.close();
  }
}
