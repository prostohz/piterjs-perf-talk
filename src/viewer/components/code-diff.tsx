import { useEffect, useState } from "react";
import type { Attempt } from "../../pipeline/report.js";
import { diffLineCounts, type AttemptDiff, type RunSummary } from "../model.js";

export function CodeDiff({
  run,
  attempt,
  cumulative = false,
}: {
  run: RunSummary;
  attempt: Attempt;
  cumulative?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AttemptDiff>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || attempt.status === "running") return;
    const controller = new AbortController();
    setResult(undefined);
    setError("");
    const query = new URLSearchParams({
      target: run.target,
      run: run.id,
      attempt: attempt.id,
    });
    const endpoint = cumulative ? "run-diff" : "diff";
    void fetch(`/api/${endpoint}?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) setResult(value as AttemptDiff);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [open, run.target, run.id, attempt.id, attempt.status, cumulative]);

  const counts = result ? diffLineCounts(result.patch) : undefined;

  return (
    <details
      className="my-5 min-w-0 border-b"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="min-h-11 py-3 text-sm leading-normal font-medium hover:text-primary">
        {cumulative ? "Итоговые изменения кода" : "Изменения кода"}
        {counts && (
          <span
            className="ml-3 inline-flex gap-2 font-mono text-xs"
            aria-label="Изменения строк"
          >
            <span className="text-success">+{counts.added}</span>
            <span className="text-destructive">−{counts.removed}</span>
          </span>
        )}
      </summary>
      {open && (
        <div className="border-t">
          <p className="px-3.5 py-3 text-xs text-muted-foreground">
            {cumulative ? "Baseline" : attempt.parent} → {attempt.id}
          </p>
          {attempt.status === "running" ? (
            <p className="px-3.5 pb-3 text-xs text-muted-foreground">
              Дифф будет доступен после завершения итерации.
            </p>
          ) : error ? (
            <p role="alert" className="px-3.5 pb-3 text-xs text-destructive">
              {error}
            </p>
          ) : !result ? (
            <p
              role="status"
              className="px-3.5 pb-3 text-xs text-muted-foreground"
            >
              Загрузка диффа…
            </p>
          ) : !result.patch ? (
            <p className="px-3.5 pb-3 text-xs text-muted-foreground">
              Изменений кода нет.
            </p>
          ) : (
            <pre
              aria-label="Дифф кода"
              className="max-h-[560px] overflow-auto border-t py-2 text-xs leading-5"
            >
              <code className="block min-w-max">
                {result.patch.split("\n").map((line, index) => (
                  <span
                    key={index}
                    className={`block px-3.5 ${
                      line.startsWith("+")
                        ? "bg-success-muted text-success"
                        : line.startsWith("-")
                          ? "bg-danger-muted text-destructive"
                          : line.startsWith("@@")
                            ? "bg-accent text-muted-foreground"
                            : ""
                    }`}
                  >
                    {line || " "}
                  </span>
                ))}
              </code>
            </pre>
          )}
        </div>
      )}
    </details>
  );
}
