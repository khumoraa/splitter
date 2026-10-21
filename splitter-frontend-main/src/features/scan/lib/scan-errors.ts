/**
 * Maps an API failure to a translation key and the next best action. The UI never shows server text:
 * it translates by the stable `code` (or by the failure kind when there was no answer).
 */
export interface ScanFailure {
  kind?: 'network' | 'timeout' | 'http' | 'cancelled' | 'unknown' | undefined;
  status?: number | undefined;
  code?: string | undefined;
  details?: unknown;
}

export type ScanErrorAction = 'retry' | 'retake' | 'none';

export interface ScanErrorInfo {
  /** i18n key under scan.errors.* */
  key: string;
  action: ScanErrorAction;
  /** the code to put in the flow state */
  code: string;
}

const REASONS = ['UNSUPPORTED_TYPE', 'TOO_SMALL', 'TOO_LARGE_DIMENSIONS', 'BLANK', 'CORRUPT'];

export function describeScanFailure(f: ScanFailure): ScanErrorInfo {
  if (f.kind === 'network') return { key: 'scan.errors.offline', action: 'retry', code: 'OFFLINE' };
  if (f.kind === 'timeout') return { key: 'scan.errors.timeout', action: 'retry', code: 'TIMEOUT' };
  switch (f.code) {
    case 'INVALID_IMAGE': {
      const reason = (f.details as { reason?: string } | null | undefined)?.reason;
      const r = reason && REASONS.includes(reason) ? reason : 'CORRUPT';
      return { key: `scan.errors.invalidImage.${r}`, action: 'retake', code: 'INVALID_IMAGE' };
    }
    case 'IMAGE_TOO_LARGE': return { key: 'scan.errors.imageTooLarge', action: 'retake', code: f.code };
    case 'QUOTA_EXCEEDED': return { key: 'scan.errors.quota', action: 'none', code: f.code };
    case 'AI_UNAVAILABLE': return { key: 'scan.errors.aiUnavailable', action: 'retry', code: f.code };
    case 'NOT_A_RECEIPT': return { key: 'scan.errors.notAReceipt', action: 'retake', code: f.code };
    case 'PARSE_FAILED': return { key: 'scan.errors.parseFailed', action: 'retry', code: f.code };
    case 'REQUEST_IN_PROGRESS': return { key: 'scan.errors.inProgress', action: 'none', code: f.code };
    default:
      if (f.status === 429) return { key: 'scan.errors.quota', action: 'none', code: 'QUOTA_EXCEEDED' };
      if (f.status === 503) return { key: 'scan.errors.aiUnavailable', action: 'retry', code: 'AI_UNAVAILABLE' };
      if (f.status === 413) return { key: 'scan.errors.imageTooLarge', action: 'retake', code: 'IMAGE_TOO_LARGE' };
      return { key: 'scan.errors.unknown', action: 'retry', code: 'UNKNOWN' };
  }
}

/** Every key describeScanFailure can return (used by the translation-parity test). */
export const SCAN_ERROR_KEYS: string[] = [
  'scan.errors.offline', 'scan.errors.timeout', 'scan.errors.imageTooLarge', 'scan.errors.quota', 'scan.errors.aiUnavailable',
  'scan.errors.notAReceipt', 'scan.errors.parseFailed', 'scan.errors.inProgress', 'scan.errors.unknown',
  ...REASONS.map((r) => `scan.errors.invalidImage.${r}`),
];
