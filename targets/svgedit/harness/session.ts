import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { command, browserCache } from "./command.js";
import { scenarios } from "./fixtures.js";
import { serve } from "./server.js";
import { measure } from "./browser.js";
import type { TargetSession } from "../../../src/target.js";

export async function createSession(library: string): Promise<TargetSession> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache;
  const { chromium } = await import("playwright");
  const server = await serve(join(library, "dist/editor"));
  const browser = await chromium
    .launch({ headless: true })
    .catch(async (error) => {
      await server.close();
      throw error;
    });
  let closed = false;
  let productionReady = true;
  return {
    async createWorker() {
      if (closed || !productionReady)
        throw new Error("Production session is not ready");
      return createSession(library);
    },
    async test() {
      if (closed) throw new Error("Session is closed");
      productionReady = false;
      const summaryPath = join(library, "coverage/coverage-summary.json");
      const originalSummary = await readFile(summaryPath);
      try {
        const output = await command("npm", ["test"], library);
        if (
          /Skipping e2e tests/.test(output) ||
          !/^\s+\d+ passed \([\d.]+[ms]+\)/m.test(output)
        )
          throw new Error("Full Playwright suite did not complete");
        await command("npm", ["run", "build"], library);
        productionReady = true;
      } finally {
        await writeFile(summaryPath, originalSummary);
      }
    },
    async measure(scenario, metric) {
      if (closed || !scenarios.includes(scenario))
        throw new Error(`Invalid scenario or closed session: ${scenario}`);
      if (metric !== "operationTimeMs")
        throw new Error(`Unsupported metric: ${metric}`);
      if (!productionReady) throw new Error("Production build is not ready");
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        serviceWorkers: "block",
      });
      const failures: string[] = [];
      try {
        await context.route("**/*", async (route) => {
          const url = route.request().url();
          if (url.startsWith(`${server.origin}/`)) return route.continue();
          failures.push(`Unexpected external request: ${url}`);
          await route.abort();
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => failures.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 400)
            failures.push(`HTTP ${response.status()}: ${response.url()}`);
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        const operationTimeMs = await measure(page, server.origin, scenario);
        if (failures.length) throw new Error(failures.join("\n"));
        if (!Number.isFinite(operationTimeMs) || operationTimeMs <= 0)
          throw new Error("Invalid duration");
        return { operationTimeMs };
      } finally {
        await context.close();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await browser.close();
      } finally {
        await server.close();
      }
    },
  };
}
