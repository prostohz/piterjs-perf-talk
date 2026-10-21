import { useEffect, useRef, useState } from "react";
import {
  scenarios,
  workingDurationMs,
  type RunDetail,
  type RunSummary,
} from "../model.js";
import { Button } from "./ui/button.js";
import { TableBody, TableCell, TableHead, TableRow } from "./ui/table.js";
import {
  attemptName,
  ColumnHeadings,
  DataTable,
  Delta,
  Disclosure,
  formatDate,
  formatNumber,
  Measured,
  RawText,
  StatusBadge,
} from "./shared.js";
import { HistoryChart } from "./history-chart.js";
import { AttemptDetail } from "./attempt-detail.js";
import { CodeDiff } from "./code-diff.js";

export function RunView({
  detail,
  run,
}: {
  detail: RunDetail;
  run: RunSummary;
}) {
  const report = detail.report;
  const names = scenarios(report);
  const [chosenAttempt, setAttempt] = useState(
    report.best ?? report.attempts[0]?.id ?? "",
  );
  const attempt =
    report.attempts.find((a) => a.id === chosenAttempt) ??
    report.attempts.find((a) => a.id === report.best) ??
    report.attempts[0];
  const attemptsList = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = attemptsList.current;
    const selected = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !selected) return;
    const revealSelected = () => {
      if (
        selected.offsetTop < list.scrollTop ||
        selected.offsetTop + selected.offsetHeight >
          list.scrollTop + list.clientHeight
      )
        list.scrollTop =
          selected.offsetTop - (list.clientHeight - selected.offsetHeight) / 2;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    return () => observer.disconnect();
  }, [attempt?.id]);
  const metric = report.config.targetMetric;
  const baseline = report.attempts.find((a) => a.parent === null);
  const best = report.attempts.find((a) => a.id === report.best);
  const accepted = report.attempts.filter(
    (a) => a.parent !== null && a.status === "accepted",
  ).length;
  const iterations = report.attempts.filter((a) => a.parent !== null).length;
  const duration = report.finishedAt
    ? `${formatNumber(workingDurationMs(report) / 60000)} мин`
    : "ещё не завершён";
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
            {run.target}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground wrap-anywhere">
            {run.id}
          </p>
        </div>
        <StatusBadge status={report.status} />
      </header>
      <div className="mt-6 grid grid-cols-[1.3fr_1fr_1fr_0.7fr_1.3fr] gap-6 border-b pb-6">
        {[
          ["Начало", formatDate(report.startedAt)],
          ["Длительность", duration],
          ["Итераций принято", `${accepted} / ${iterations}`],
          ["Сценариев", names.length],
          ["Метрика", metric],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <span className="mb-1 block text-xs text-muted-foreground">
              {label}
            </span>
            <strong className="text-sm font-semibold wrap-anywhere">
              {value}
            </strong>
          </div>
        ))}
      </div>
      <section className="mt-8" aria-label="Динамика cost">
        <h3 className="text-center text-base leading-snug font-semibold">
          Прогресс оптимизации: итераций — {iterations}, принято — {accepted}
        </h3>
        <HistoryChart report={report} attemptId={attempt?.id ?? ""} />
      </section>
      {best && <CodeDiff key={best.id} run={run} attempt={best} cumulative />}
      <section className="mt-8">
        <h3 className="text-lg leading-normal font-semibold">
          Результат по сценариям
        </h3>
        <div id="overview" className="mt-4">
          <DataTable>
            <ColumnHeadings
              columns={["Сценарий", "Baseline", "Итог", "Улучшение"]}
            />
            <TableBody>
              {names.map((name) => (
                <TableRow key={name}>
                  <TableHead scope="row" className="text-left text-foreground">
                    {name}
                  </TableHead>
                  <TableCell>
                    <Measured
                      stats={baseline?.measurements[name]?.[metric]}
                      report={report}
                    />
                  </TableCell>
                  <TableCell>
                    <Measured
                      stats={best?.measurements[name]?.[metric]}
                      report={report}
                    />
                  </TableCell>
                  <TableCell>
                    <Delta
                      before={baseline?.measurements[name]?.[metric]}
                      after={best?.measurements[name]?.[metric]}
                      report={report}
                      metric={metric}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        </div>
      </section>
      <section className="mt-8">
        <h3 className="text-lg leading-normal font-semibold">Итерации</h3>
        <div className="mt-4 grid grid-cols-[224px_minmax(0,1fr)] gap-8">
          <nav
            ref={attemptsList}
            id="attempts"
            aria-label="Итерации"
            className="relative min-h-0 min-w-0 space-y-1 overflow-y-auto border-r p-1 pr-3 [contain:size] [scrollbar-width:thin]"
          >
            {report.attempts.map((a) => (
              <Button
                key={a.id}
                variant="ghost"
                data-attempt={a.id}
                aria-pressed={a.id === attempt?.id}
                onClick={() => setAttempt(a.id)}
                className="block h-auto w-full p-3 text-left whitespace-normal shadow-none active:bg-accent aria-pressed:bg-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--border)]"
              >
                <span>
                  <strong className="text-sm font-semibold">
                    {attemptName(a)}
                    {a.id === report.best && (
                      <small className="ml-2 text-xs font-medium text-success">
                        ИТОГ
                      </small>
                    )}
                  </strong>
                  <span className="mt-1 mb-2 block truncate text-xs font-normal text-muted-foreground">
                    {a.hypothesis ?? "Исходная версия"}
                  </span>
                  <StatusBadge status={a.status} />
                </span>
              </Button>
            ))}
          </nav>
          {attempt ? (
            <AttemptDetail
              key={attempt.id}
              run={run}
              report={report}
              attempt={attempt}
            />
          ) : (
            <p className="py-12 text-muted-foreground">Попыток пока нет.</p>
          )}
        </div>
      </section>
      <section className="mt-8">
        <Disclosure title="Конфигурация и окружение">
          <RawText>
            {JSON.stringify(
              {
                config: report.config,
                environment: report.environment,
                periods: report.periods,
              },
              null,
              2,
            )}
          </RawText>
        </Disclosure>
        <Disclosure title="События прогона">
          <RawText>{detail.events || "Событий пока нет."}</RawText>
        </Disclosure>
      </section>
    </>
  );
}
