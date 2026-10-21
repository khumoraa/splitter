/** Sliding-window counter. Pure and clock-injectable, so it is easy to test. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;
  // (no constructor parameter properties: this file is also run by Node's built-in TypeScript stripping in tests)
  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  /** Records an attempt for `key`; returns whether it is allowed and, if not, when to retry. */
  hit(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number; remaining: number } {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return { allowed: false, retryAfterMs: Math.max(1, list[0]! + this.windowMs - now), remaining: 0 };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, retryAfterMs: 0, remaining: this.max - list.length };
  }

  /** Drops keys with no recent hits (call from a timer to avoid unbounded growth). */
  sweep(now: number = Date.now()): void {
    const from = now - this.windowMs;
    for (const [k, list] of this.hits) if (!list.some((t) => t > from)) this.hits.delete(k);
  }
}
