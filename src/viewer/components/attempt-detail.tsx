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
        {a.id} · Reference: {a.parent ?? "none (baseline)"}
      </p>
      <p className="my-5 text-sm leading-6 whitespace-pre-wrap wrap-anywhere">
        {a.hypothesis?.trimEnd() ??
          (a.parent === null
            ? "Original library snapshot before any changes."
            : "No hypothesis recorded yet.")}
      </p>
      {a.cost !== undefined && (
        <p className="my-5 text-sm leading-6">
          Cost:{" "}
          <strong>
            {a.cost === null
              ? "undefined"
              : a.cost.toLocaleString("en-US", { maximumSignificantDigits: 6 })}
          </strong>
          {a.decision?.referenceCost !== undefined && (
            <>
              {" "}
              · reference:{" "}
              <strong>
                {a.decision.referenceCost.toLocaleString("en-US", {
                  maximumSignificantDigits: 6,
                })}
              </strong>
            </>
          )}
          {a.decision?.improvementPercent != null && (
            <>
              {" "}
              · improvement:{" "}
              <strong>{formatNumber(a.decision.improvementPercent)}%</strong>
            </>
          )}
        </p>
      )}
      {a.parent !== null && <CodeDiff run={run} attempt={a} />}
      <DataTable>
        <ColumnHeadings
          columns={[
            "Scenario",
            `Reference, ${measurementUnit(metric)}`,
            `Attempt, ${measurementUnit(metric)}`,
            "Improvement",
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
        <Disclosure title="All samples, p95, and range">
          <DataTable className="min-w-[44rem] [&_th:first-child]:w-[26%] [&_th:nth-child(2)]:w-[12%] [&_th:nth-child(3)]:w-[20%] [&_th:nth-child(4)]:w-[12%]">
            <ColumnHeadings
              columns={[
                "Scenario",
                `p95, ${measurementUnit(metric)}`,
                `min … max, ${measurementUnit(metric)}`,
                `Range, ${measurementUnit(metric)}`,
                `Samples, ${measurementUnit(metric)}`,
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
        <p className="text-muted-foreground">No measurements recorded yet.</p>
      )}
      {a.errors.length > 0 && (
        <Disclosure title={`Attempt errors and fixes (${a.errors.length})`}>
          <RawText>{a.errors.join("\n\n")}</RawText>
        </Disclosure>
      )}
    </article>
  );
}
