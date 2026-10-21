/**
 * What the "New receipt" screen offers. Manual entry is ALWAYS enabled: whatever happens to the AI path
 * (offline, limit exhausted, service down) the user has a way forward. Pure function, no React.
 */
export type AiBlockReason = 'offline' | 'quota_exhausted' | 'unavailable';

export interface ScanOptionsInput {
  online: boolean;
  quotaStatus: 'loading' | 'ok' | 'error';
  remaining: number | null;
  /** how the quota request failed, when quotaStatus === 'error' */
  quotaErrorKind?: 'network' | 'timeout' | 'http' | 'unknown' | undefined;
  quotaErrorStatus?: number | undefined;
}

export interface ScanOptions {
  ai: { enabled: boolean; reason: AiBlockReason | null };
  manual: { enabled: true };
}

export function getScanOptions(i: ScanOptionsInput): ScanOptions {
  const manual = { enabled: true as const };
  if (!i.online) return { ai: { enabled: false, reason: 'offline' }, manual };
  if (i.quotaStatus === 'ok' && i.remaining !== null && i.remaining <= 0) return { ai: { enabled: false, reason: 'quota_exhausted' }, manual };
  if (i.quotaStatus === 'error') {
    if (i.quotaErrorKind === 'network' || i.quotaErrorKind === 'timeout') return { ai: { enabled: false, reason: 'offline' }, manual };
    if (i.quotaErrorStatus === 429) return { ai: { enabled: false, reason: 'quota_exhausted' }, manual };
    if (i.quotaErrorStatus !== undefined && i.quotaErrorStatus >= 500) return { ai: { enabled: false, reason: 'unavailable' }, manual };
  }
  // loading or an unclear error: do not block, the server decides at scan time
  return { ai: { enabled: true, reason: null }, manual };
}
