/**
 * Spend/usage log for receipt scanning. One JSON line per event, with NO personal data:
 * no user id, no image, no receipt text, no amounts. Counters only (calls, errors, cache hits, blocks).
 * Per-user numbers live in the ScanRequest table; `npm run scan:usage` summarises them.
 */
export type ScanEvent =
  | "ai_call"
  | "ai_error"
  | "cache_hit"
  | "replay"
  | "quota_block"
  | "invalid_image"
  | "invalid_too_large"
  | "invalid_request";

const counters: Record<string, number> = {};

export function logScan(event: ScanEvent, extra: { ms?: number; status?: number | undefined } = {}): void {
  counters[event] = (counters[event] ?? 0) + 1;
  if (process.env.NODE_ENV === "test") return;
  console.log(JSON.stringify({ scan: event, ...(extra.ms !== undefined ? { ms: extra.ms } : {}), ...(extra.status !== undefined ? { status: extra.status } : {}), t: new Date().toISOString() }));
}

export const scanCounters = () => ({ ...counters });
