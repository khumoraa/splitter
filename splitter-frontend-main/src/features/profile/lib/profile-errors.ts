/**
 * Maps a failed profile request to an i18n key. Decides by the server's stable `code`, then HTTP status, then error
 * kind, never by message text. Duck-typed on purpose (works with ApiError and with plain objects in tests).
 */
export type ProfileContext = 'general' | 'avatar';
type MaybeApiError = { kind?: string; status?: number; code?: string } | null | undefined;

const BY_CODE: Record<string, string> = {
  USERNAME_REQUIRED: 'profile.errors.usernameRequired',
  USERNAME_LENGTH: 'profile.errors.usernameLength',
  USERNAME_CHARS: 'profile.errors.usernameChars',
  INVALID_EMAIL: 'profile.errors.emailInvalid',
  EMAIL_IN_USE: 'profile.errors.emailInUse',
  PASSWORD_REQUIRED: 'profile.errors.passwordRequired',
  WRONG_PASSWORD: 'profile.errors.wrongPassword',
  WEAK_PASSWORD: 'auth.errors.passwordLength',
  SAME_PASSWORD: 'profile.errors.samePassword',
};

export function profileErrorKey(error: unknown, context: ProfileContext = 'general'): string {
  const e = (typeof error === 'object' ? error : undefined) as MaybeApiError;
  if (e?.code && BY_CODE[e.code]) return BY_CODE[e.code]!;
  if (e?.kind === 'network') return 'errors.network';
  if (e?.kind === 'timeout') return 'errors.timeout';
  if (e?.kind === 'cancelled') return 'profile.errors.cancelled';
  switch (e?.status) {
    case 401: return 'errors.unauthorized';
    case 413: return 'profile.errors.avatarTooLarge';
    case 415: return 'profile.errors.avatarUnsupported';
    case 429: return 'profile.errors.tooManyRequests';
    case 503: return context === 'avatar' ? 'profile.errors.storageUnavailable' : 'errors.server';
    default: break;
  }
  if (e?.status !== undefined && e.status >= 500) return 'errors.server';
  return 'errors.unexpected';
}
