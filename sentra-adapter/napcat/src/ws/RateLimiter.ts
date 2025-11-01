export interface RateLimiterOptions {
  maxConcurrency: number; // max in-flight requests
  minIntervalMs: number;  // minimum interval between sends
}

export class RateLimiter {
  private maxConcurrency: number;
  private minIntervalMs: number;
  private inFlight = 0;
  private lastSentAt = 0;
  private queue: Array<() => void> = [];
  private scheduled = false;

  constructor(opts: RateLimiterOptions) {
    this.maxConcurrency = Math.max(1, opts.maxConcurrency);
    this.minIntervalMs = Math.max(0, opts.minIntervalMs);
  }

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      const task = () => {
        const now = Date.now();
        const wait = Math.max(0, this.minIntervalMs - (now - this.lastSentAt));
        const run = () => {
          this.inFlight++;
          this.lastSentAt = Date.now();
          resolve();
        };
        if (wait > 0) setTimeout(run, wait); else run();
      };
      this.queue.push(task);
      this.tryDispatch();
    });
  }

  release() {
    if (this.inFlight > 0) this.inFlight--;
    this.tryDispatch();
  }

  private tryDispatch() {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      while (this.inFlight < this.maxConcurrency && this.queue.length > 0) {
        const fn = this.queue.shift()!;
        fn();
      }
    });
  }
}
