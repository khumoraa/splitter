/**
 * Per-user scan quota over rolling windows. Pure module (no imports).
 * `chargedAt` = timestamps (ms) of calls that reached the paid model. Cache hits, idempotent replays,
 * invalid input and AI outages are never charged, so they are never in this list.
 * A rolling window frees one slot when the OLDEST counted call leaves the window, which is what `resetAt` reports.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTH_MS = 30 * DAY_MS;

export type QuotaLimits = { daily: number; monthly: number };

export type QuotaState = {
  /** the tighter of the two windows */
  remaining: number;
  limit: number;
  /** ISO time when at least one more recognition becomes available; null while `remaining` > 0 */
  resetAt: string | null;
  daily: { used: number; limit: number; remaining: number };
  monthly: { used: number; limit: number; remaining: number };
};

function windowState(chargedAt: number[], now: number, windowMs: number, limit: number) {
  const inWindow = chargedAt.filter((t) => t > now - windowMs).sort((a, b) => a - b);
  const used = inWindow.length;
  const remaining = Math.max(0, limit - used);
  // slot frees when the (used - limit + 1)-th oldest call expires
  const oldest = remaining > 0 ? undefined : inWindow[used - limit];
  const freeAt = oldest === undefined ? null : oldest + windowMs;
  return { used, limit, remaining, freeAt };
}

export function computeQuota(chargedAt: number[], now: number, limits: QuotaLimits): QuotaState {
  const d = windowState(chargedAt, now, DAY_MS, limits.daily);
  const m = windowState(chargedAt, now, MONTH_MS, limits.monthly);
  const remaining = Math.min(d.remaining, m.remaining);
  const limiting = d.remaining <= m.remaining ? d : m;
  const frees = [d.freeAt, m.freeAt].filter((x): x is number => x != null);
  // blocked until BOTH exhausted windows free a slot
  const resetAt = remaining > 0 || frees.length === 0 ? null : new Date(Math.max(...frees)).toISOString();
  return {
    remaining,
    limit: limiting.limit,
    resetAt,
    daily: { used: d.used, limit: d.limit, remaining: d.remaining },
    monthly: { used: m.used, limit: m.limit, remaining: m.remaining },
  };
}

export function readLimits(env: Record<string, string | undefined>): QuotaLimits {
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return v != null && v.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : def;
  };
  return { daily: num(env.SCAN_LIMIT_DAILY, 10), monthly: num(env.SCAN_LIMIT_MONTHLY, 100) };
}
