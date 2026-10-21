import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { finished } from "node:stream/promises";
import { join } from "node:path";

export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

export class CodexConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly events: WriteStream;
  private readonly stderr: WriteStream;
  private readonly requests: WriteStream;
  private readonly closed: Promise<void>;
  private readonly failed: Promise<never>;
  private rejectFailure!: (error: unknown) => void;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >();
  private nextId = 0;
  private closing = false;
  private broken = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly abort: () => void;

  constructor(
    args: string[],
    cwd: string,
    directory: string,
    private readonly signal: AbortSignal,
    handleRequest: (message: RpcMessage) => Promise<unknown>,
    handleNotification: (message: RpcMessage) => void,
  ) {
    signal.throwIfAborted();
    this.failed = new Promise((_, reject) => {
      this.rejectFailure = reject;
    });
    void this.failed.catch(() => {});
    this.events = createWriteStream(join(directory, "events.jsonl"));
    this.requests = createWriteStream(join(directory, "requests.jsonl"));
    this.stderr = createWriteStream(join(directory, "stderr.log"));
    this.child = spawn("codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.pipe(this.stderr, { end: false });
    this.lines = createInterface({ input: this.child.stdout });
    this.closed = new Promise((resolve) =>
      this.child.once("close", () => resolve()),
    );
    this.abort = () => {
      this.fail(signal.reason);
      this.child.kill("SIGTERM");
    };

    this.requests.on("error", (error) => this.fail(error));
    this.events.on("error", (error) => this.fail(error));
    this.stderr.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => {
      if (!this.closing) this.fail(error);
    });
    this.child.on("exit", (code) => {
      if (!this.closing)
        this.fail(
          new Error(`Codex app-server exited before completion: ${code}`),
        );
    });
    this.lines.on("line", (line) => {
      this.events.write(`${line}\n`);
      this.queue = this.queue
        .then(async () => {
          if (this.broken || this.closing) return;
          const message = JSON.parse(line) as RpcMessage;
          if (message.method && message.id !== undefined) {
            const result = await handleRequest(message);
            if (!this.broken && !this.closing)
              this.send({ id: message.id, result });
          } else if (message.id !== undefined) {
            const waiter = this.pending.get(Number(message.id));
            if (!waiter)
              throw new Error(`Unexpected Codex response: ${message.id}`);
            this.pending.delete(Number(message.id));
            if (message.error) waiter.reject(new Error(message.error.message));
            else waiter.resolve(message.result);
          } else if (message.method) {
            handleNotification(message);
          } else {
            throw new Error("Malformed Codex protocol message");
          }
        })
        .catch((error) => this.fail(error));
    });

    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) this.abort();
  }

  private fail(error: unknown): void {
    this.broken = true;
    this.rejectFailure(error);
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  private send(message: RpcMessage): void {
    this.signal.throwIfAborted();
    const line = `${JSON.stringify(message)}\n`;
    this.requests.write(line);
    this.child.stdin.write(line);
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.fail(error);
      }
    });
    return this.until(response);
  }

  notify(method: string): void {
    this.send({ method });
  }

  until<T>(operation: Promise<T>): Promise<T> {
    return Promise.race([operation, this.failed]);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.signal.removeEventListener("abort", this.abort);
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 500);

    try {
      await this.closed;
    } finally {
      clearTimeout(timer);
      this.lines.close();
      this.events.end();
      this.stderr.end();
      this.requests.end();
      await Promise.all([
        finished(this.events),
        finished(this.stderr),
        finished(this.requests),
      ]);
    }
  }
}
