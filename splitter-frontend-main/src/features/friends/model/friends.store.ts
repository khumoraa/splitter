import { create } from 'zustand';
import { onSessionCleanup } from '@/shared/lib/session-cleanup';
import { isApiError } from '@/shared/api/api-error';
import { socialErrorKey } from '@/features/social/lib/errors';
import { FriendsApi } from '../api/friends.api';
import type { RequestsPayload, User } from './types';

type State = {
  /** flat list of accepted friends, newest data from the server */
  friends: User[];
  /** null until the first successful load (profile uses this to show a skeleton) */
  requestsRaw: RequestsPayload | null;
  loading: boolean;
  error?: string;
  /** i18n key for `error` */
  errorKey?: string;
};

type Actions = {
  fetchAll: () => Promise<void>;
  send: (uniqueId: string) => Promise<'requested' | 'accepted'>;
  cancel: (uniqueId: string) => Promise<void>;
  accept: (user: User) => Promise<void>;
  reject: (user: User) => Promise<void>;
  remove: (uniqueId: string) => Promise<void>;
};

let inflight: Promise<void> | null = null;

export const useFriendsStore = create<State & Actions>((set, get) => ({
  friends: [],
  requestsRaw: null,
  loading: false,

  fetchAll() {
    if (inflight) return inflight; // several screens ask at once: one request
    set({ loading: true, error: undefined, errorKey: undefined });
    inflight = (async () => {
      try {
        const [friends, requestsRaw] = await Promise.all([FriendsApi.list(), FriendsApi.requests()]);
        set({ friends, requestsRaw });
      } catch (e) {
        if (isApiError(e) && e.kind === 'cancelled') return;
        set({ error: e instanceof Error ? e.message : 'Failed to load', errorKey: socialErrorKey(isApiError(e) ? e : {}) });
      } finally {
        set({ loading: false });
        inflight = null;
      }
    })();
    return inflight;
  },

  async send(uniqueId) {
    const { action } = await FriendsApi.sendRequest(uniqueId);
    await get().fetchAll();
    return action;
  },

  async cancel(uniqueId) {
    await FriendsApi.cancelRequest(uniqueId);
    await get().fetchAll();
  },

  // accepting / rejecting is safe to show at once: the row leaves the list, and comes back if the server refuses
  async accept(user) {
    const before = get().requestsRaw;
    if (before) set({ requestsRaw: { ...before, incoming: before.incoming.filter((r) => r.from.id !== user.id) } });
    try {
      await FriendsApi.accept(user);
    } catch (e) {
      set({ requestsRaw: before });
      throw e;
    } finally {
      await get().fetchAll();
    }
  },

  async reject(user) {
    const before = get().requestsRaw;
    if (before) set({ requestsRaw: { ...before, incoming: before.incoming.filter((r) => r.from.id !== user.id) } });
    try {
      await FriendsApi.reject(user);
    } catch (e) {
      set({ requestsRaw: before });
      throw e;
    } finally {
      await get().fetchAll();
    }
  },

  async remove(uniqueId) {
    const before = get().friends;
    set({ friends: before.filter((f) => f.uniqueId !== uniqueId) });
    try {
      await FriendsApi.remove(uniqueId);
    } catch (e) {
      set({ friends: before });
      throw e;
    }
  },
}));

onSessionCleanup(() => {
  inflight = null;
  useFriendsStore.setState({ friends: [], requestsRaw: null, loading: false, error: undefined, errorKey: undefined });
});
