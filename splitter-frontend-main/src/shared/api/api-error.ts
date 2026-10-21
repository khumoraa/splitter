export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'cancelled' | 'unknown';

/**
 * Error thrown by apiClient. Callers should branch on `kind` / `status`, never on the
 * (translated) message text.
 */
export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  /** stable machine code from the server (e.g. WRONG_PASSWORD, EMAIL_IN_USE); map it to a translated message */
  code?: string;
  /** extra machine-readable fields of the server answer (e.g. { reason } for INVALID_IMAGE, { resetAt } for QUOTA_EXCEEDED) */
  details?: Record<string, unknown>;

  constructor(message: string, kind: ApiErrorKind, status?: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Console level for a failed request. Expected client-side outcomes (401 expired token, 400 wrong password,
 * 409 duplicate email, ...) are warnings: console.error opens the red LogBox/error overlay in dev builds,
 * which is wrong for something the UI already handles. Server errors (5xx) and no-response failures stay errors.
 */
export const logLevelForStatus = (status?: number): 'warn' | 'error' =>
  status !== undefined && status >= 400 && status < 500 ? 'warn' : 'error';

export const isApiError =(e: unknown): e is ApiError => e instanceof ApiError;
export const isUnauthorized = (e: unknown): boolean => isApiError(e) && e.status === 401;
/** The request was aborted on purpose (AbortController / axios cancel); not a failure to show to the user. */
export const isCancelled = (e: unknown): boolean => isApiError(e) && e.kind === 'cancelled';
export const isOffline = (e: unknown): boolean => isApiError(e) && (e.kind === 'network' || e.kind === 'timeout');
