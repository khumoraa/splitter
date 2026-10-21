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

/**
 * Console level for any caught failure. Being offline, a timeout, a cancelled request and 4xx answers are conditions
 * the UI already explains to the user, so they are warnings (no red error overlay in dev); only unexpected failures
 * (5xx, programming errors) are errors.
 */
export const logLevelForError = (e: unknown): 'warn' | 'error' => {
  if (!(e instanceof ApiError)) return 'error';
  if (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'cancelled') return 'warn';
  return logLevelForStatus(e.status);
};
export const isUnauthorized = (e: unknown): boolean => isApiError(e) && e.status === 401;
/** The request was aborted on purpose (AbortController / axios cancel); not a failure to show to the user. */
export const isCancelled = (e: unknown): boolean => isApiError(e) && e.kind === 'cancelled';
export const isOffline = (e: unknown): boolean => isApiError(e) && (e.kind === 'network' || e.kind === 'timeout');
