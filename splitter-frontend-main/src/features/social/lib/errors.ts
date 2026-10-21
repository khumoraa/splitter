/** Maps API failures of the friends/groups features to translation keys. Pure. */
export const SOCIAL_ERROR_CODES = [
  'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'RATE_LIMITED', 'CANNOT_ADD_SELF', 'ALREADY_FRIENDS', 'REQUEST_EXISTS',
  'REQUEST_RECEIVED', 'REQUEST_COOLDOWN', 'REQUEST_NOT_ALLOWED', 'ALREADY_MEMBER', 'NOT_A_MEMBER', 'CANNOT_INVITE_SELF',
  'INVITATION_EXISTS', 'INVITATION_NOT_PENDING', 'FRIENDSHIP_REQUIRED', 'OWNER_CANNOT_LEAVE', 'CANNOT_REMOVE_OWNER', 'GROUP_FULL',
  'INVITE_LIMIT', 'TOKEN_EXPIRED', 'TOKEN_INVALID',
] as const;

export interface Failure { kind?: string | undefined; status?: number | undefined; code?: string | undefined }

/** i18n key for a failure; the UI never shows server text. */
export function socialErrorKey(f: Failure): string {
  if (f.kind === 'network' || f.kind === 'timeout') return 'social.errors.offline';
  if (f.code && (SOCIAL_ERROR_CODES as readonly string[]).includes(f.code)) return `social.errors.${f.code}`;
  if (f.status === 429) return 'social.errors.RATE_LIMITED';
  if (f.status === 404) return 'social.errors.NOT_FOUND';
  if (f.status === 403) return 'social.errors.FORBIDDEN';
  return 'social.errors.unknown';
}

/** Every key socialErrorKey can return (used by the translation test). */
export const SOCIAL_ERROR_KEYS: string[] = [...SOCIAL_ERROR_CODES.map((c) => `social.errors.${c}`), 'social.errors.offline', 'social.errors.unknown'];
