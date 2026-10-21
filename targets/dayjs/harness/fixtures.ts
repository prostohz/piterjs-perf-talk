export const scenarios = [
  "parse-iso",
  "parse-timestamps",
  "format-table",
  "format-localized",
  "parse-custom-strict",
  "calendar-grid",
  "deadline-arithmetic",
  "filter-date-range",
  "diff-dates",
  "relative-time",
  "timezone-convert",
  "timezone-parse",
];

export const clock = "2024-06-15T12:00:00.000Z";
export const zones = [
  "America/New_York",
  "Europe/London",
  "Asia/Kolkata",
  "Australia/Sydney",
];
export const records = Array.from({ length: 2400 }, (_, index) => {
  const timestamp = Date.UTC(2023, 0, 1) + ((index * 7919) % 1052640) * 60000;
  const iso = new Date(timestamp).toISOString();
  return {
    timestamp,
    iso,
    local: iso.slice(0, 19).replace("T", " "),
    input:
      index % 7 === 0
        ? "31/02/2024 12:00"
        : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`,
    zone: zones[index % zones.length]!,
    locale: ["en", "de", "fr"][index % 3]!,
  };
});
