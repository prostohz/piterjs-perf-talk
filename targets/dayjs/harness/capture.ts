import { operation } from "./operations.js";
import { scenarios } from "./fixtures.js";

declare global {
  interface Window {
    captureDayjs: () => Record<string, string[]>;
  }
}

window.captureDayjs = () =>
  Object.fromEntries(
    scenarios.map((scenario) => [scenario, operation(scenario)]),
  );
