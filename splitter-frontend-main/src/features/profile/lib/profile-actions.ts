import { validateEmail, validatePasswordChange, validateUsername } from './validation.ts';
import { profileErrorKey, type ProfileContext } from './profile-errors.ts';

export interface ProfileUser {
  id: number;
  email: string;
  username: string;
  uniqueId: string;
  avatarUrl: string | null;
}

export interface ProfileApi {
  updateUsername(username: string): Promise<ProfileUser>;
  updateEmail(email: string, currentPassword: string): Promise<ProfileUser>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  uploadAvatar(file: { uri: string; name: string; type: string }, onProgress?: (percent: number) => void): Promise<ProfileUser>;
  removeAvatar(): Promise<ProfileUser>;
  deleteAccount(password: string): Promise<void>;
}

export interface ProfileDeps {
  api: ProfileApi;
  getUser(): ProfileUser | null;
  setUser(user: ProfileUser): void;
  logout(): Promise<void>;
}

export type ActionResult = { ok: true } | { ok: false; key: string };

/**
 * Everything the profile screens do, with the network and the store injected so it can be tested.
 * Rule: the signed-in user in the store only changes AFTER the server confirmed; a failure leaves the old values untouched.
 */
export function createProfileActions(deps: ProfileDeps) {
  const fail = (error: unknown, context: ProfileContext = 'general'): ActionResult => ({ ok: false, key: profileErrorKey(error, context) });

  return {
    async changeUsername(raw: string): Promise<ActionResult> {
      const v = validateUsername(raw);
      if (!v.ok) return { ok: false, key: v.key };
      if (deps.getUser()?.username === v.value) return { ok: true };
      try {
        deps.setUser(await deps.api.updateUsername(v.value));
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    async changeEmail(rawEmail: string, currentPassword: string): Promise<ActionResult> {
      const v = validateEmail(rawEmail);
      if (!v.ok) return { ok: false, key: v.key };
      if (!currentPassword) return { ok: false, key: 'profile.errors.passwordRequired' };
      try {
        deps.setUser(await deps.api.updateEmail(v.value, currentPassword));
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    async changePassword(current: string, next: string, confirm: string): Promise<ActionResult> {
      const key = validatePasswordChange({ current, next, confirm });
      if (key) return { ok: false, key };
      try {
        await deps.api.changePassword(current, next);
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    async setAvatar(file: { uri: string; name: string; type: string }, onProgress?: (percent: number) => void): Promise<ActionResult> {
      try {
        deps.setUser(await deps.api.uploadAvatar(file, onProgress));
        return { ok: true };
      } catch (e) {
        return fail(e, 'avatar'); // the old avatar stays in the store and on the server
      }
    },

    async resetAvatar(): Promise<ActionResult> {
      if (!deps.getUser()?.avatarUrl) return { ok: true };
      try {
        deps.setUser(await deps.api.removeAvatar());
        return { ok: true };
      } catch (e) {
        return fail(e, 'avatar');
      }
    },

    async signOut(): Promise<void> {
      await deps.logout();
    },

    async deleteAccount(password: string): Promise<ActionResult> {
      if (!password) return { ok: false, key: 'profile.errors.passwordRequired' };
      try {
        await deps.api.deleteAccount(password);
      } catch (e) {
        return fail(e);
      }
      await deps.logout(); // the server already deleted the account: drop the token and the local profile
      return { ok: true };
    },
  };
}
