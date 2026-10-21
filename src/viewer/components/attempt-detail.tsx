import type { Attempt, Report } from "../../pipeline/report.js";
import { reference, type RunSummary } from "../model.js";
import { CodeDiff } from "./code-diff.js";
import { TableBody, TableCell, TableHead, TableRow } from "./ui/table.js";
import {
  attemptName,
  ColumnHeadings,
  DataTable,
  Delta,
  Disclosure,
  formatMeasurement,
  formatNumber,
  measurementUnit,
  Measured,
  RawText,
  StatusBadge,
} from "./shared.js";

export function AttemptDetail({
  run,
  report,
  attempt: a,
}: {
  run: RunSummary;
  report: Report;
  attempt: Attempt;
}) {
  const parent = reference(report, a);
  const names = [
    ...new Set([
      ...Object.keys(parent?.measurements ?? {}),
      ...Object.keys(a.measurements),
    ]),
  ];
  const metric = report.config.targetMetric;
  return (
    <article id="attempt-detail" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-base font-semibold">{attemptName(a)}</h3>
        <StatusBadge status={a.status} />
      </div>
      <p className="mt-2 mb-5 text-xs text-muted-foreground wrap-anywhere">
        {a.id} · Ориентир: {a.parent ?? "нет — исходное измерение"}
      </p>
      <p className="my-5 text-sm leading-6 whitespace-pre-wrap wrap-anywhere">
        {a.hypothesis?.trimEnd() ??
          (a.parent === null
            ? "Исходный слепок библиотеки до изменений."
            : "Гипотеза ещё не сохранена.")}
      </p>
      {a.cost !== undefined && (
        <p className="my-5 text-sm leading-6">
          Cost:{" "}
          <strong>
            {a.cost === null
              ? "не определён"
              : a.cost.toLocaleString("ru-RU", { maximumSignificantDigits: 6 })}
          </strong>
          {a.decision?.referenceCost !== undefined && (
            <>
              {" "}
              · ориентир:{" "}
              <strong>
                {a.decision.referenceCost.toLocaleString("ru-RU", {
                  maximumSignificantDigits: 6,
                })}
              </strong>
            </>
          )}
          {a.decision?.improvementPercent != null && (
            <>
              {" "}
              · улучшение:{" "}
              <strong>{formatNumber(a.decision.improvementPercent)}%</strong>
            </>
          )}
        </p>
      )}
      {a.parent !== null && <CodeDiff run={run} attempt={a} />}
      <DataTable>
        <ColumnHeadings
          columns={[
            "Сценарий",
            `Ориентир, ${measurementUnit(metric)}`,
            `Попытка, ${measurementUnit(metric)}`,
            "Улучшение",
          ]}
        />
        <TableBody>
          {names.map((name) => (
            <TableRow key={name}>
              <TableHead scope="row" className="text-left">
                {name}
              </TableHead>
              <TableCell>
                <Measured
                  stats={parent?.measurements[name]?.[metric]}
                  report={report}
                />
              </TableCell>
              <TableCell>
                <Measured
                  stats={a.measurements[name]?.[metric]}
                  report={report}
                />
              </TableCell>
              <TableCell>
                <Delta
                  before={parent?.measurements[name]?.[metric]}
                  after={a.measurements[name]?.[metric]}
                  report={report}
                  metric={metric}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      {names.length ? (
        <Disclosure title="Все замеры, p95 и разброс">
          <DataTable className="min-w-[44rem] [&_th:first-child]:w-[26%] [&_th:nth-child(2)]:w-[12%] [&_th:nth-child(3)]:w-[20%] [&_th:nth-child(4)]:w-[12%]">
            <ColumnHeadings
              columns={[
                "Сценарий",
                `p95, ${measurementUnit(metric)}`,
                `min … max, ${measurementUnit(metric)}`,
                `Разброс, ${measurementUnit(metric)}`,
                `Серия, ${measurementUnit(metric)}`,
              ]}
            />
            <TableBody>
              {names.map((name) => {
                const stats = a.measurements[name]?.[metric];
                if (!stats) return null;
                return (
                  <TableRow key={name}>
                    <TableHead scope="row" className="text-left">
                      {name}
                    </TableHead>
                    <TableCell>
                      {formatMeasurement(stats.p95, metric)}
                    </TableCell>
                    <TableCell>
                      {formatMeasurement(stats.min, metric)} …{" "}
                      {formatMeasurement(stats.max, metric)}
                    </TableCell>
                    <TableCell>
                      {formatMeasurement(stats.spread, metric)}
                    </TableCell>
                    <TableCell className="whitespace-normal wrap-anywhere">
                      {stats.samples
                        .map((value) => formatMeasurement(value, metric))
                        .join("; ")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </DataTable>
        </Disclosure>
      ) : (
        <p className="text-muted-foreground">Замеры ещё не сохранены.</p>
      )}
      {a.errors.length > 0 && (
        <Disclosure
          title={`Ошибки и исправления в ходе попытки (${a.errors.length})`}
        >
          <RawText>{a.errors.join("\n\n")}</RawText>
        </Disclosure>
      )}
    </article>
  );
}
