import { expect, it } from "vitest";
import { Budget } from "../../src/runtime/budget.js";

it("rejects a pending operation when the run is cancelled", async () => {
  const controller = new AbortController();
  const budget = new Budget(new Date().toISOString(), 1, controller.signal);
  const pending = budget.within(() => new Promise(() => {}));
  const assertion = expect(pending).rejects.toThrow("Cancelled");

  controller.abort(new Error("Cancelled"));

  await assertion;
  expect(budget.interrupted).toBe(true);
});

it("does not start more work after the deadline", async () => {
  const budget = new Budget(
    new Date(Date.now() - 120_000).toISOString(),
    1,
    new AbortController().signal,
  );
  let started = false;

  await expect(
    budget.within(async () => {
      started = true;
    }),
  ).rejects.toThrow("Time budget exhausted");

  expect(started).toBe(false);
});
