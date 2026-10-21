import type { ComponentProps, ReactNode } from "react";
import { Badge } from "./ui/badge.js";
import { NativeSelect } from "./ui/native-select.js";
import { Table, TableHead, TableHeader, TableRow } from "./ui/table.js";
import type { Attempt, Report } from "../../pipeline/report.js";
import type { Metric, Statistics } from "../../pipeline/metrics.js";
import { complete, improvement } from "../model.js";
import { cn } from "../lib/utils.js";

export const formatNumber = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
export const measurementUnit = (metric: Metric) =>
  metric === "operationTimeMs" || metric === "reactRenderTimeMs"
    ? "мкс"
    : metric === "rafFps"
      ? "FPS"
      : "шт.";
export const formatMeasurement = (value: number, metric: Metric) =>
  metric === "operationTimeMs" || metric === "reactRenderTimeMs"
    ? (value * 1000).toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    : formatNumber(value);
export const formatDate = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
export const labels: Record<string, string> = {
  running: "В процессе",
  completed: "Завершён",
  accepted: "Принята",
  rejected: "Отклонена",
  failed: "Ошибка",
  interrupted: "Прерван",
  snapshot: "Копирование",
  agent: "Работа агента",
  prepare: "Подготовка",
  test: "Тесты",
  measure: "Измерения",
  done: "Завершено",
};
export const attemptName = (a: Attempt) =>
  a.parent === null
    ? "Baseline"
    : `Итерация ${Number(a.id.replace("iteration-", "")) || a.id}`;

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1.5 rounded-none border-0 bg-transparent p-0 text-xs font-medium",
        {
          "text-success": status === "accepted" || status === "completed",
          "text-destructive": status === "failed" || status === "rejected",
          "text-warning": status === "interrupted" || status === "running",
        },
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[status] ?? status}
    </Badge>
  );
}

export function Picker({
  label,
  id,
  ...props
}: ComponentProps<typeof NativeSelect> & { label: string; id: string }) {
  return (
    <label
      htmlFor={id}
      className="block min-w-0 text-xs text-muted-foreground [&>div]:mt-1 [&>div]:w-full"
    >
      <span>{label}</span>
      <NativeSelect
        id={id}
        className="h-11 bg-card text-foreground shadow-none"
        {...props}
      />
    </label>
  );
}

export function Measured({
  stats,
  report,
}: {
  stats: Statistics | undefined;
  report: Report;
}) {
  if (!stats) return <>—</>;
  return (
    <>
      {formatMeasurement(stats.median, report.config.targetMetric)}
      {!complete(stats, report) && (
        <small>
          {" "}
          ({stats.samples.length}/{report.config.measurements.repeats})
        </small>
      )}
    </>
  );
}

export function Delta({
  before,
  after,
  report,
  metric,
}: {
  before: Statistics | undefined;
  after: Statistics | undefined;
  report: Report;
  metric: Metric;
}) {
  if (
    !before ||
    !after ||
    !complete(before, report) ||
    !complete(after, report)
  )
    return <span className="text-muted-foreground">—</span>;
  const value = improvement(before.median, after.median, metric);
  if (value === null)
    return <span className="text-muted-foreground">— (ориентир 0)</span>;
  return (
    <span
      className={
        value === 0
          ? "text-muted-foreground"
          : value > 0
            ? "text-success"
            : "text-destructive"
      }
    >
      {value > 0 ? "+" : ""}
      {formatNumber(value)}%
    </span>
  );
}

export function DataTable({
  children,
  className,
  ...props
}: ComponentProps<typeof Table>) {
  return (
    <div className="max-w-full border-y bg-card">
      <Table
        className={cn(
          "table-fixed caption-top text-right text-sm tabular-nums [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5 [&_th]:font-normal [&_th]:whitespace-normal [&_tbody_th]:wrap-anywhere [&_th:first-child]:w-[36%]",
          className,
        )}
        {...props}
      >
        {children}
      </Table>
    </div>
  );
}

export function ColumnHeadings({ columns }: { columns: string[] }) {
  return (
    <TableHeader className="bg-muted text-xs [&_th]:font-medium">
      <TableRow>
        {columns.map((column, i) => (
          <TableHead
            key={column}
            className={i === 0 ? "text-left" : "text-right"}
          >
            {column}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export function Disclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="border-b">
      <summary className="min-h-11 py-3 text-sm leading-normal hover:text-primary">
        {title}
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

export function RawText({ children }: { children: string }) {
  return (
    <pre className="max-h-[420px] overflow-y-auto bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
      {children}
    </pre>
  );
}
