/**
 * Client-side validation for the profile forms. The rules are the SAME as on the server
 * (splitter-backend/src/utils/username.ts and validation.ts); validation.test.mjs compares the two on a table of inputs.
 * Functions return i18n keys, never English text.
 */
import { passwordIssue } from '../../../shared/lib/utils/password.ts';

export type UsernameResult = { ok: true; value: string } | { ok: false; key: string };

export function validateUsername(raw: string): UsernameResult {
  const value = String(raw ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!value) return { ok: false, key: 'profile.errors.usernameRequired' };
  const length = [...value].length;
  if (length < 2 || length > 32) return { ok: false, key: 'profile.errors.usernameLength' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u.test(value)) return { ok: false, key: 'profile.errors.usernameChars' };
  return { ok: true, value };
}

export type EmailResult = { ok: true; value: string } | { ok: false; key: string };

export function validateEmail(raw: string): EmailResult {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return { ok: false, key: 'profile.errors.emailRequired' };
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, key: 'profile.errors.emailInvalid' };
  return { ok: true, value };
}

/** Returns the i18n key of the first problem with a password change form, or null when it can be submitted. */
export function validatePasswordChange(input: { current: string; next: string; confirm: string }): string | null {
  if (!input.current) return 'profile.errors.currentPasswordRequired';
  const issue = passwordIssue(input.next);
  if (issue) return issue;
  if (input.next !== input.confirm) return 'profile.errors.passwordMismatch';
  if (input.next === input.current) return 'profile.errors.samePassword';
  return null;
}
