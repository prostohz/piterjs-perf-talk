import {
  ResponsiveLine,
  type LineCustomSvgLayerProps,
  type PointTooltipProps,
} from "@nivo/line";
import type { Attempt, Report } from "../../pipeline/report.js";
import { attemptName, formatNumber, labels } from "./shared.js";
import { cn } from "../lib/utils.js";

type ChartProps = {
  report: Report;
  attemptId: string;
};

type CostSeries = {
  id: "attempts";
  data: {
    x: number;
    y: number | null;
    attempt: Attempt;
    reference: number | null;
    selected: boolean;
  }[];
};

const chartColors = {
  kept: "var(--success)",
  reference: "var(--success)",
  rejected: "var(--chart-rejected)",
  outline: "var(--success)",
  label: "var(--success)",
  grid: "var(--chart-grid)",
};

const formatCost = (value: number) =>
  value.toLocaleString("ru-RU", { maximumSignificantDigits: 6 });

function ReferenceLine({
  series,
  yScale,
  lineGenerator,
}: LineCustomSvgLayerProps<CostSeries>) {
  const points = series.flatMap((series) =>
    series.data.flatMap((point) =>
      point.data.reference === null
        ? []
        : [{ x: point.position.x, y: yScale(point.data.reference) }],
    ),
  );
  return (
    <path
      d={lineGenerator(points) ?? undefined}
      fill="none"
      stroke={chartColors.reference}
      strokeWidth={2.5}
    />
  );
}

function PlotFrame({
  innerWidth,
  innerHeight,
}: LineCustomSvgLayerProps<CostSeries>) {
  return (
    <rect
      width={innerWidth}
      height={innerHeight}
      fill="none"
      stroke="var(--chart-axis)"
      strokeWidth={1}
    />
  );
}

function AttemptAnnotations({ points }: LineCustomSvgLayerProps<CostSeries>) {
  return (
    <g pointerEvents="none">
      {points.map((point) => {
        const { attempt, selected } = point.data;
        const accepted = attempt.status === "accepted";
        return (
          <g key={point.id} transform={`translate(${point.x}, ${point.y})`}>
            {accepted && (
              <circle
                r="4.5"
                fill={chartColors.kept}
                stroke={chartColors.outline}
                strokeWidth="1.2"
              />
            )}
            {selected && (
              <circle
                r="8"
                fill="none"
                stroke={chartColors.outline}
                strokeWidth="1.2"
              />
            )}
            {accepted && (
              <text
                transform="translate(10, -12) rotate(-32)"
                fill={chartColors.label}
                fontSize="11"
              >
                {attemptName(attempt)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function CostTooltip({
  point,
  lastIndex,
}: PointTooltipProps<CostSeries> & { lastIndex: number }) {
  const { attempt, reference } = point.data;
  const cost = attempt.cost;
  return (
    <div
      className={cn(
        "relative min-w-44 rounded border bg-card px-3 py-2 text-xs text-foreground shadow-sm",
        point.data.x < lastIndex * 0.15
          ? "left-1/2"
          : point.data.x > lastIndex * 0.85
            ? "-left-1/2"
            : undefined,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <strong>{attemptName(attempt)}</strong>
        <span className="text-muted-foreground">{labels[attempt.status]}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span>Cost</span>
        <strong>{typeof cost === "number" ? formatCost(cost) : "—"}</strong>
      </div>
      {reference !== null && (
        <div className="mt-1 flex justify-between gap-6 text-muted-foreground">
          <span>Ориентир</span>
          <span>{formatCost(reference)}</span>
        </div>
      )}
    </div>
  );
}

export function HistoryChart({ report, attemptId }: ChartProps) {
  let reference: number | null = null;
  const attempts: CostSeries["data"] = report.attempts.map((attempt, x) => {
    const cost =
      typeof attempt.cost === "number" && Number.isFinite(attempt.cost)
        ? attempt.cost
        : null;
    if (attempt.status === "accepted" && cost !== null) reference = cost;
    return {
      x,
      y: cost,
      attempt,
      reference,
      selected: attempt.id === attemptId,
    };
  });
  if (!attempts.some((point) => point.y !== null))
    return (
      <div id="cost-plot" className="py-12 text-muted-foreground">
        Cost ещё не рассчитан.
      </div>
    );

  const lastIndex = attempts.length - 1;
  const minimumStep = Math.max(1, Math.ceil(lastIndex / 8));
  const unit = 10 ** Math.floor(Math.log10(minimumStep));
  const tickStep =
    unit *
    (minimumStep <= unit
      ? 1
      : minimumStep <= unit * 2
        ? 2
        : minimumStep <= unit * 5
          ? 5
          : 10);
  const ticks = attempts.flatMap((_, i) =>
    i === 0 ||
    i === lastIndex ||
    (i % tickStep === 0 && lastIndex - i >= tickStep)
      ? [i]
      : [],
  );
  const selected = attempts.find((point) => point.selected);
  const values = attempts.flatMap((point) =>
    point.y === null ? [] : [point.y],
  );
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding =
    Math.max(maximum - minimum, Math.abs(maximum) * 0.05, 0.01) * 0.12;
  const data: CostSeries[] = [{ id: "attempts", data: attempts }];

  return (
    <div id="cost-plot">
      <div className="relative h-[420px]">
        <div
          className="absolute top-8 right-10 z-10 space-y-1 rounded-sm border bg-background/95 px-3 py-2 text-xs"
          aria-label="Легенда графика"
        >
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-chart-rejected" />
            Отклонена
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full border border-success bg-success" />
            Принята
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-success" />
            Ориентир
          </div>
        </div>
        <ResponsiveLine<CostSeries>
          data={data}
          margin={{ top: 24, right: 32, bottom: 52, left: 64 }}
          xScale={{
            type: "linear",
            min: -Math.max(lastIndex * 0.025, 0.5),
            max: Math.max(lastIndex, 1) + Math.max(lastIndex * 0.06, 0.5),
            nice: false,
          }}
          yScale={{
            type: "linear",
            min: Math.max(0, minimum - padding),
            max: maximum + padding,
            nice: true,
            stacked: false,
          }}
          curve="stepAfter"
          axisLeft={{
            tickValues: 5,
            tickSize: 4,
            tickPadding: 8,
            format: formatCost,
            legend: "Cost",
            legendOffset: -48,
            legendPosition: "middle",
          }}
          axisBottom={{
            tickValues: ticks,
            tickSize: 4,
            tickPadding: 8,
            format: formatNumber,
            legend: "Итерация",
            legendOffset: 38,
            legendPosition: "middle",
          }}
          enableGridX
          gridXValues={ticks}
          gridYValues={5}
          pointSize={5}
          layers={[
            "grid",
            PlotFrame,
            "markers",
            "axes",
            ReferenceLine,
            "crosshair",
            "points",
            AttemptAnnotations,
            "mesh",
          ]}
          pointColor={({ point }) =>
            point.data.attempt.status === "accepted"
              ? chartColors.kept
              : chartColors.rejected
          }
          pointBorderWidth={0}
          useMesh
          tooltip={(props) => <CostTooltip {...props} lastIndex={lastIndex} />}
          enableCrosshair
          crosshairType="x"
          markers={
            selected
              ? [
                  {
                    axis: "x",
                    value: selected.x,
                    lineStyle: {
                      stroke: "var(--border)",
                      strokeWidth: 1,
                      strokeDasharray: "3 5",
                    },
                  },
                ]
              : []
          }
          theme={{
            text: {
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fill: "var(--muted-foreground)",
            },
            axis: {
              ticks: {
                text: { fill: "var(--chart-tick)", fontSize: 12 },
                line: { stroke: "var(--chart-axis)", strokeWidth: 1 },
              },
              legend: { text: { fill: "var(--chart-legend)", fontSize: 13 } },
            },
            grid: {
              line: {
                stroke: chartColors.grid,
                strokeWidth: 1,
              },
            },
            crosshair: {
              line: {
                stroke: "var(--muted-foreground)",
                strokeWidth: 1,
                strokeDasharray: "3 5",
              },
            },
          }}
          animate={false}
          role="img"
          ariaLabel="История cost по итерациям"
          isFocusable
          pointAriaLabel={(point) =>
            `${attemptName(point.data.attempt)}: cost ${point.data.attempt.cost === null || point.data.attempt.cost === undefined ? "не рассчитан" : formatCost(point.data.attempt.cost)} · ${labels[point.data.attempt.status]}`
          }
        />
      </div>
    </div>
  );
}
