/**
 * Same password policy as the server (backend/src/utils/validation.ts isStrongPassword):
 * at least 8 characters with an uppercase letter, a lowercase letter, a digit and a special character.
 * Returns the i18n key of the first problem, or null when the password is acceptable.
 */
export type PasswordIssueKey =
  | 'auth.errors.passwordLength'
  | 'auth.errors.passwordUpper'
  | 'auth.errors.passwordLower'
  | 'auth.errors.passwordDigit'
  | 'auth.errors.passwordSpecial';

export function passwordIssue(pw: string): PasswordIssueKey | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'auth.errors.passwordLength';
  if (!/[A-Z]/.test(pw)) return 'auth.errors.passwordUpper';
  if (!/[a-z]/.test(pw)) return 'auth.errors.passwordLower';
  if (!/\d/.test(pw)) return 'auth.errors.passwordDigit';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'auth.errors.passwordSpecial';
  return null;
}
