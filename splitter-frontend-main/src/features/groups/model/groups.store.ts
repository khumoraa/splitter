import { create } from 'zustand';
import { isApiError } from '@/shared/api/api-error';
import { socialErrorKey } from '@/features/social/lib/errors';
import { GroupsApi, type Group, type GroupDetails, type Invitation, type SentInvitation } from '../api/groups.api';
import type { User } from '@/features/friends/model/types';

type State = {
  groups: Group[];
  /** invitations addressed to me; null until loaded */
  invitations: Invitation[] | null;
  current?: GroupDetails;
  /** invitations the owner sent for `current` (owner only) */
  sent: SentInvitation[];
  counts: Record<number, number>;
  loading: boolean;
  /** true after the first groups response */
  loaded: boolean;
  error?: string;
  errorKey?: string;
};

type Actions = {
  fetchGroups: () => Promise<void>;
  fetchInvitations: () => Promise<void>;
  openGroup: (groupId: number) => Promise<void>;
  createGroup: (name: string, friendUniqueIds?: string[]) => Promise<{ id: number; name: string }>;
  renameGroup: (groupId: number, name: string) => Promise<void>;
  deleteGroup: (groupId: number) => Promise<void>;
  addMembers: (groupId: number, uniqueIds: string[]) => Promise<{ added: string[]; skipped: { uniqueId: string; code: string }[] }>;
  removeMember: (groupId: number, uniqueId: string) => Promise<void>;
  leaveGroup: (groupId: number) => Promise<void>;
  transferOwnership: (groupId: number, uniqueId: string) => Promise<void>;
  invite: (groupId: number, user: Pick<User, 'uniqueId'>) => Promise<void>;
  cancelInvitation: (groupId: number, invitationId: number) => Promise<void>;
  acceptInvitation: (invitation: Invitation) => Promise<void>;
  declineInvitation: (invitation: Invitation) => Promise<void>;
  clearCurrent: () => void;
};

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Failed to load', errorKey: socialErrorKey(isApiError(e) ? e : {}) });

export const useGroupsStore = create<State & Actions>((set, get) => ({
  groups: [],
  invitations: null,
  sent: [],
  counts: {},
  loading: false,
  loaded: false,

  async fetchGroups() {
    set({ loading: true, error: undefined, errorKey: undefined });
    try {
      const groups = await GroupsApi.list();
      const counts: Record<number, number> = {};
      for (const g of groups) counts[g.id] = g.counts?.members ?? g.members?.length ?? 0;
      set((s) => ({ groups, counts: { ...s.counts, ...counts }, loaded: true }));
    } catch (e) {
      if (!(isApiError(e) && e.kind === 'cancelled')) set(fail(e));
    } finally {
      set({ loading: false });
    }
  },

  async fetchInvitations() {
    try {
      set({ invitations: await GroupsApi.myInvitations() });
    } catch (e) {
      if (get().invitations === null) set({ invitations: [] });
      if (!(isApiError(e) && e.kind === 'cancelled')) set(fail(e));
    }
  },

  async openGroup(groupId) {
    set({ loading: true, error: undefined, errorKey: undefined });
    try {
      const current = await GroupsApi.details(groupId);
      const sent = current.role === 'owner' ? await GroupsApi.sentInvitations(groupId).catch(() => []) : [];
      set((s) => ({
        current,
        sent,
        counts: { ...s.counts, [groupId]: current.members.length },
        groups: s.groups.map((g) => (g.id === groupId ? { ...g, members: current.members } : g)),
      }));
    } catch (e) {
      if (!(isApiError(e) && e.kind === 'cancelled')) set(fail(e));
    } finally {
      set({ loading: false });
    }
  },

  async createGroup(name, friendUniqueIds = []) {
    const g = await GroupsApi.create(name);
    if (friendUniqueIds.length) await GroupsApi.addMembers(g.id, friendUniqueIds).catch(() => undefined);
    await get().fetchGroups();
    return g;
  },

  async renameGroup(groupId, name) {
    await GroupsApi.rename(groupId, name);
    await Promise.all([get().openGroup(groupId), get().fetchGroups()]);
  },

  async deleteGroup(groupId) {
    await GroupsApi.remove(groupId);
    set((s) => ({ current: undefined, sent: [], groups: s.groups.filter((g) => g.id !== groupId) }));
    await get().fetchGroups();
  },

  async addMembers(groupId, uniqueIds) {
    const r = await GroupsApi.addMembers(groupId, uniqueIds);
    await Promise.all([get().openGroup(groupId), get().fetchGroups()]);
    return r;
  },

  async removeMember(groupId, uniqueId) {
    await GroupsApi.removeMember(groupId, uniqueId);
    await Promise.all([get().openGroup(groupId), get().fetchGroups()]);
  },

  async leaveGroup(groupId) {
    await GroupsApi.leave(groupId);
    set((s) => ({ current: undefined, groups: s.groups.filter((g) => g.id !== groupId) }));
    await get().fetchGroups();
  },

  async transferOwnership(groupId, uniqueId) {
    await GroupsApi.transfer(groupId, uniqueId);
    await Promise.all([get().openGroup(groupId), get().fetchGroups()]);
  },

  async invite(groupId, user) {
    await GroupsApi.invite(groupId, user);
    set({ sent: await GroupsApi.sentInvitations(groupId).catch(() => get().sent) });
  },

  async cancelInvitation(groupId, invitationId) {
    const before = get().sent;
    set({ sent: before.filter((i) => i.id !== invitationId) });
    try {
      await GroupsApi.cancelInvitation(groupId, invitationId);
    } catch (e) {
      set({ sent: before });
      throw e;
    }
  },

  // answering is shown at once and rolled back when the server refuses
  async acceptInvitation(invitation) {
    const before = get().invitations;
    set({ invitations: (before ?? []).filter((i) => i.id !== invitation.id) });
    try {
      await GroupsApi.accept(invitation.id);
      await get().fetchGroups();
    } catch (e) {
      set({ invitations: before });
      await get().fetchInvitations();
      throw e;
    }
  },

  async declineInvitation(invitation) {
    const before = get().invitations;
    set({ invitations: (before ?? []).filter((i) => i.id !== invitation.id) });
    try {
      await GroupsApi.decline(invitation.id);
    } catch (e) {
      set({ invitations: before });
      await get().fetchInvitations();
      throw e;
    }
  },

  clearCurrent() {
    set({ current: undefined, sent: [] });
  },
}));
