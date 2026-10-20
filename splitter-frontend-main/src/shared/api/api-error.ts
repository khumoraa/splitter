export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'unknown';

/**
 * Error thrown by apiClient. Callers should branch on `kind` / `status`, never on the
 * (translated) message text.
 */
export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;

  constructor(message: string, kind: ApiErrorKind, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
export const isUnauthorized = (e: unknown): boolean => isApiError(e) && e.status === 401;
export const isOffline = (e: unknown): boolean => isApiError(e) && (e.kind === 'network' || e.kind === 'timeout');
