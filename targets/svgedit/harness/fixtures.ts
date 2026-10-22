const counts: Record<string, number> = {
  "select-500": 500,
  "move-500": 500,
  "duplicate-500": 500,
  "group-500": 500,
  "ungroup-500": 500,
  "align-left-500": 500,
  "fill-500": 500,
  "delete-500": 500,
  "undo-move-500": 500,
  "redo-move-500": 500,
};

export const scenarios = Object.keys(counts);

export function fixture(scenario: string) {
  const count = counts[scenario];
  if (!count) throw new Error(`Invalid scenario: ${scenario}`);
  const height = Math.max(600, 40 + Math.ceil(count / 40) * 20);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}">${Array.from(
    { length: count },
    (_, i) => {
      const x = 20 + (i % 40) * 20;
      const y = 20 + Math.floor(i / 40) * 20;
      return i % 2
        ? `<circle id="fixture_${i}" cx="${x + 6}" cy="${y + 6}" r="6" fill="#5080b0"/>`
        : `<rect id="fixture_${i}" x="${x}" y="${y}" width="12" height="12" fill="#b08050"/>`;
    },
  ).join("")}</svg>`;
  return { count, svg };
}
