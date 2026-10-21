import { operation } from "./operations.js";
import { scenarios } from "./fixtures.js";
import expected from "./expected.json" with { type: "json" };

const expectations = expected.scenarios as Record<
  string,
  { count: number; sha256: string }
>;
let measured = false;

async function measureDayjs(scenario: string) {
  if (measured || !scenarios.includes(scenario))
    throw new Error("Invalid or repeated scenario");
  measured = true;
  const start = performance.now();
  const rows = operation(scenario);
  const operationTimeMs = performance.now() - start;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(rows)),
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const oracle = expectations[scenario];
  if (!oracle || rows.length !== oracle.count || sha256 !== oracle.sha256)
    throw new Error(`Date output mismatch: ${scenario}`);
  return { operationTimeMs };
}

declare global {
  interface Window {
    measureDayjs: typeof measureDayjs;
  }
}

window.measureDayjs = measureDayjs;
