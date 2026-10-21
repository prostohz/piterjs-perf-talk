import dayjs from "measured-dayjs";
import utc from "measured-utc";
import timezone from "measured-timezone";
import customParseFormat from "measured-custom-parse";
import relativeTime from "measured-relative";
import localizedFormat from "measured-localized";
import "measured-de";
import "measured-fr";
import { clock, records } from "./fixtures.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export function operation(scenario: string): string[] {
  switch (scenario) {
    case "parse-iso":
      return records.map(({ iso }) => {
        const date = dayjs(iso);
        return `${date.valueOf()}|${date.isValid()}|${date.year()}|${date.month()}|${date.date()}`;
      });
    case "parse-timestamps":
      return records.map(({ timestamp }) => {
        const date = dayjs(timestamp);
        return `${date.toISOString()}|${date.unix()}`;
      });
    case "format-table":
      return records.map(({ iso }) =>
        dayjs(iso).format("YYYY-MM-DD HH:mm:ss [UTC]"),
      );
    case "format-localized":
      return records.map(({ iso, locale }) =>
        dayjs(iso).locale(locale).format("LLLL"),
      );
    case "parse-custom-strict":
      return records.map(({ input }) => {
        const date = dayjs(input, "DD/MM/YYYY HH:mm", true);
        return date.isValid() ? date.toISOString() : "invalid";
      });
    case "calendar-grid":
      return records.slice(0, 120).flatMap(({ iso }) => {
        const month = dayjs(iso).startOf("month");
        const start = month.startOf("week");
        return Array.from({ length: 42 }, (_, index) => {
          const date = start.add(index, "day");
          return `${date.format("YYYY-MM-DD")}|${date.isSame(month, "month")}|${date.day()}`;
        });
      });
    case "deadline-arithmetic":
      return records.map(({ iso }, index) => {
        const original = dayjs(iso);
        const deadline = original
          .add(index % 13, "month")
          .add(index % 31, "day")
          .endOf("day");
        return `${deadline.toISOString()}|${deadline.subtract(2, "week").startOf("day").toISOString()}|${original.toISOString()}`;
      });
    case "filter-date-range": {
      const start = dayjs("2024-01-01T00:00:00Z");
      const end = dayjs("2024-07-01T00:00:00Z");
      return records
        .filter(({ iso }) => {
          const date = dayjs(iso);
          return !date.isBefore(start) && date.isBefore(end);
        })
        .map(({ iso }) => iso);
    }
    case "diff-dates":
      return records.map(({ iso }, index) => {
        const start = dayjs(iso);
        const end = dayjs(records[(index + 53) % records.length]!.iso);
        return `${end.diff(start, "day")}|${end.diff(start, "month", true).toFixed(9)}|${end.diff(start, "hour")}`;
      });
    case "relative-time":
      return records.map(({ iso, locale }) =>
        dayjs(iso).locale(locale).from(clock),
      );
    case "timezone-convert":
      return records.slice(0, 600).map(({ iso, zone }) => {
        const date = dayjs.utc(iso).tz(zone);
        return `${date.format("YYYY-MM-DD HH:mm:ss Z")}|${date.valueOf()}|${date.utcOffset()}`;
      });
    case "timezone-parse":
      return records.slice(0, 600).map(({ local, zone }) => {
        const date = dayjs.tz(local, zone);
        return `${date.toISOString()}|${date.format("YYYY-MM-DD HH:mm:ss Z")}`;
      });
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}
