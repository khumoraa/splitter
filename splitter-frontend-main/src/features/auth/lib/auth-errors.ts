/**
 * Maps a failed login/register request to a message in the user's language.
 * Decides by HTTP status / error kind, never by the (server, English) message text.
 * Pure: `t` is passed in so it can be unit-tested.
 */
export type AuthFlow = 'login' | 'register';
type Translate = (key: string, defaultValue?: string) => string;

/** Adapts react-i18next's overloaded t() to the simple signature used here. */
export const asTranslate =
  (t: (key: string, defaultValue: string) => string): Translate =>
  (key, defaultValue) =>
    t(key, defaultValue ?? key);
type MaybeApiError = { status?: number; kind?: string; message?: string } | null | undefined;

export function authErrorMessage(error: unknown, flow: AuthFlow, t: Translate): string {
  const e = (typeof error === 'object' ? error : undefined) as MaybeApiError;

  // No connection / timeout: apiClient already produced a translated message
  if (e?.kind === 'network' || e?.kind === 'timeout') {
    return e.message || t('errors.network', 'No connection to the server. Check your internet and try again.');
  }

  const status = e?.status;
  if (status === 409 && flow === 'register') {
    return t('auth.errors.emailInUse', 'This email is already registered. Try signing in.');
  }
  if (status === 400) {
    return flow === 'login'
      ? t('auth.errors.invalidCredentials', 'Wrong email or password.')
      : t('auth.errors.registerInvalid', 'Please check the entered data and try again.');
  }
  if (status !== undefined && status >= 500) {
    return t('errors.server', 'Server error. Please try again later.');
  }
  return flow === 'login'
    ? t('auth.loginError', 'An error occurred during login')
    : t('auth.registerError', 'An error occurred during registration');
}
