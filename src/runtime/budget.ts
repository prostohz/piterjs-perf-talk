export class Budget {
  readonly deadline: number;

  constructor(
    startedAt: string,
    durationMinutes: number,
    readonly signal: AbortSignal,
  ) {
    this.deadline = Date.parse(startedAt) + durationMinutes * 60_000;
  }

  get interrupted(): boolean {
    return this.signal.aborted || Date.now() >= this.deadline;
  }

  check(): void {
    this.signal.throwIfAborted();
    if (Date.now() >= this.deadline) throw new Error("Time budget exhausted");
  }

  async within<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    let abort = () => {};

    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          abort = () => reject(this.signal.reason);
          this.signal.addEventListener("abort", abort, { once: true });
          if (this.signal.aborted) abort();
        }),
      ]);
    } finally {
      this.signal.removeEventListener("abort", abort);
    }
  }
}
