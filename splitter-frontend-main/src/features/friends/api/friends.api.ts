import { z } from 'zod';
import { apiClient } from '@/features/auth/api';
import { ZRequests, ZSearchPage, ZUser, type User } from '../model/types';

export const FriendsApi = {
  async list(): Promise<User[]> {
    const { data } = await apiClient.get('/friends');
    return z.array(ZUser).parse(data);
  },

  async requests() {
    const { data } = await apiClient.get('/friends/requests');
    return ZRequests.parse(data);
  },

  /** q = username or ID; groupId adds `groupStatus` to every hit (for inviting to that group). */
  async search(q: string, opts: { offset?: number; groupId?: number; signal?: AbortSignal } = {}) {
    const { data } = await apiClient.get('/friends/search', {
      params: { q, ...(opts.offset ? { offset: opts.offset } : {}), ...(opts.groupId !== undefined ? { groupId: opts.groupId } : {}) },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return ZSearchPage.parse(data);
  },

  async sendRequest(uniqueId: string): Promise<{ action: 'requested' | 'accepted' }> {
    const { data } = await apiClient.post('/friends/request', { uniqueId });
    return { action: data?.action === 'accepted' ? 'accepted' : 'requested' };
  },

  async accept(user: Pick<User, 'id' | 'uniqueId'>) {
    await apiClient.patch('/friends/accept', { requesterId: user.id, uniqueId: user.uniqueId });
  },

  async reject(user: Pick<User, 'id' | 'uniqueId'>) {
    await apiClient.patch('/friends/reject', { requesterId: user.id, uniqueId: user.uniqueId });
  },

  /** Cancel my own pending request. */
  async cancelRequest(uniqueId: string) {
    await apiClient.delete(`/friends/requests/${encodeURIComponent(uniqueId)}`);
  },

  async remove(uniqueId: string) {
    await apiClient.delete(`/friends/${encodeURIComponent(uniqueId)}`);
  },

  async createInvite(expiresInSeconds: number) {
    const { data } = await apiClient.post('/friends/invite', { expiresInSeconds });
    return data as { token: string; url: string; expiresAt: string };
  },

  async joinByToken(token: string) {
    const { data } = await apiClient.post('/friends/join', { token });
    return data;
  },
};
