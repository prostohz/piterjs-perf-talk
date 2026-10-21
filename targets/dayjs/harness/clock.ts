import type { Page } from "playwright";
import { clock } from "./fixtures.js";

export async function freezeDate(page: Page) {
  await page.addInitScript((timestamp) => {
    const OriginalDate = Date;
    window.Date = new Proxy(OriginalDate, {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [timestamp]);
      },
      apply() {
        return new OriginalDate(timestamp).toString();
      },
      get(target, key, receiver) {
        if (key === "now") return () => timestamp;
        return Reflect.get(target, key, receiver);
      },
    });
  }, Date.parse(clock));
}
