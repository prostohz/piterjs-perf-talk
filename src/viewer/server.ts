import type { IncomingMessage, ServerResponse } from "node:http";
import { listRuns, readRun } from "./data.js";
import { readAttemptDiff, readRunDiff } from "./diff.js";

export function createViewerApi(runsRoot: string) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(request.url!, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method !== "GET") {
        send(405, { error: "Только GET" });
        return;
      }
      if (url.pathname === "/api/runs") {
        send(200, await listRuns(runsRoot));
        return;
      }
      if (
        url.pathname === "/api/run" ||
        url.pathname === "/api/diff" ||
        url.pathname === "/api/run-diff"
      ) {
        const target = url.searchParams.get("target");
        const run = url.searchParams.get("run");
        if (!target || !run) {
          send(400, { error: "Укажите target и run" });
          return;
        }
        const attempt = url.searchParams.get("attempt");
        if (url.pathname === "/api/diff" && !attempt) {
          send(400, { error: "Укажите attempt" });
          return;
        }
        try {
          send(
            200,
            url.pathname === "/api/diff"
              ? await readAttemptDiff(runsRoot, target, run, attempt!)
              : url.pathname === "/api/run-diff"
                ? await readRunDiff(runsRoot, target, run)
                : await readRun(runsRoot, target, run),
          );
        } catch (error) {
          send(422, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      send(404, { error: "Не найдено" });
    } catch (error) {
      send(500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
