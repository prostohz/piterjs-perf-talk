import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { build, stop } from "esbuild";
import { chromium, type Browser } from "playwright";
import type { TargetSession } from "../../../src/target.js";
import { command } from "./command.js";
import { scenarios } from "./fixtures.js";
import { freezeDate } from "./clock.js";
import { browserTests } from "./browser-tests.js";

const directory = fileURLToPath(new URL(".", import.meta.url));

export async function bundle(library: string, entry = "app.ts") {
  try {
    const result = await build({
      absWorkingDir: directory,
      entryPoints: [join(directory, entry)],
      bundle: true,
      write: false,
      minify: true,
      format: "iife",
      platform: "browser",
      alias: {
        "measured-dayjs": join(library, "dayjs.min.js"),
        "measured-utc": join(library, "plugin/utc.js"),
        "measured-timezone": join(library, "plugin/timezone.js"),
        "measured-custom-parse": join(library, "plugin/customParseFormat.js"),
        "measured-relative": join(library, "plugin/relativeTime.js"),
        "measured-localized": join(library, "plugin/localizedFormat.js"),
        "measured-de": join(library, "locale/de.js"),
        "measured-fr": join(library, "locale/fr.js"),
        dayjs: join(library, "dayjs.min.js"),
      },
      tsconfigRaw: {},
      metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs).map((path) =>
      resolve(directory, path),
    );
    if (!inputs.includes(join(library, "dayjs.min.js")))
      throw new Error("Bundle does not contain the supplied snapshot");
    const output = result.outputFiles[0];
    if (!output) throw new Error("Missing browser bundle");
    return { code: output.contents, inputs };
  } finally {
    stop();
  }
}

export async function createSession(library: string): Promise<TargetSession> {
  const { code } = await bundle(library);
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    if (request.url === "/app.js") {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(code);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Day.js benchmark</title></head><body><script src="/app.js"></script></body></html>',
      );
    } else {
      response.writeHead(404).end();
    }
  });
  let browser: Browser | undefined;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await browser?.close();
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((done, fail) =>
          server.close((error) => (error ? fail(error) : done())),
        );
    }
  }
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server address");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const runningBrowser = browser;
    return {
      async test() {
        if (closed) throw new Error("Session is closed");
        await command("npm", ["run", "lint"], library);
        await command("npm", ["test"], library);
        await browserTests(runningBrowser, library);
      },
      async measure(scenario, targetMetric) {
        if (closed || !scenarios.includes(scenario))
          throw new Error(`Invalid scenario or closed session: ${scenario}`);
        if (targetMetric !== "operationTimeMs")
          throw new Error(`Unsupported metric: ${targetMetric}`);
        const context = await runningBrowser.newContext({
          viewport: { width: 1280, height: 900 },
          deviceScaleFactor: 1,
          locale: "en-US",
          timezoneId: "UTC",
          serviceWorkers: "block",
        });
        try {
          await context.route("**/*", (route) =>
            route.request().url().startsWith(`${origin}/`)
              ? route.continue()
              : route.abort(),
          );
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
          });
          const cdp = await context.newCDPSession(page);
          await cdp.send("Network.enable");
          await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
          await freezeDate(page);
          await page.goto(origin, { waitUntil: "load" });
          if (errors.length) throw new Error(errors.join("\n"));
          if (
            !(await page.evaluate(
              () =>
                window.crossOriginIsolated &&
                performance.now.toString().includes("[native code]"),
            ))
          )
            throw new Error("Native high-resolution timer is unavailable");
          await page.waitForFunction(
            () => typeof window.measureDayjs === "function",
          );
          const metrics = await page.evaluate(
            (name) => window.measureDayjs(name),
            scenario,
          );
          if (errors.length) throw new Error(errors.join("\n"));
          for (const [name, value] of Object.entries(metrics)) {
            if (!Number.isFinite(value) || value < 0)
              throw new Error(`Invalid metric: ${name}`);
          }
          return metrics;
        } finally {
          await context.close();
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
