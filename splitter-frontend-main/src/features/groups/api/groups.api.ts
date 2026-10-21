import { z } from 'zod';
import { apiClient } from '@/features/auth/api';
import { ZUser, type User } from '@/features/friends/model/types';

const enc = encodeURIComponent;

const ZMember = ZUser.extend({ role: z.enum(['owner', 'member']).optional() });
export type GroupMember = z.infer<typeof ZMember>;

const ZGroup = z.object({
  id: z.number(),
  name: z.string(),
  ownerId: z.number(),
  createdAt: z.string().optional(),
  myRole: z.enum(['owner', 'member']).optional(),
  counts: z.object({ members: z.number(), sessions: z.number() }).optional(),
  lastSession: z.object({ id: z.number(), createdAt: z.string() }).nullish(),
  members: z.array(ZMember).optional(),
});
export type Group = z.infer<typeof ZGroup>;

const ZDetails = z.object({
  group: z.object({ id: z.number(), name: z.string(), ownerId: z.number().optional(), createdAt: z.string().optional() }),
  role: z.enum(['owner', 'member']),
  members: z.array(ZMember),
});
export type GroupDetails = z.infer<typeof ZDetails>;

const ZInvitation = z.object({
  id: z.number(),
  createdAt: z.string(),
  group: z.object({ id: z.number(), name: z.string() }),
  inviter: ZUser,
});
export type Invitation = z.infer<typeof ZInvitation>;

const ZSent = z.object({ id: z.number(), createdAt: z.string(), status: z.string(), invitee: ZUser });
export type SentInvitation = z.infer<typeof ZSent>;

export const GroupsApi = {
  async list(): Promise<Group[]> {
    const { data } = await apiClient.get('/groups');
    return z.array(ZGroup).parse(data);
  },
  async create(name: string): Promise<{ id: number; name: string }> {
    const { data } = await apiClient.post('/groups', { name });
    return z.object({ id: z.number(), name: z.string() }).parse(data);
  },
  async rename(groupId: number, name: string) {
    await apiClient.patch(`/groups/${groupId}`, { name });
  },
  async remove(groupId: number) {
    await apiClient.delete(`/groups/${groupId}`);
  },
  async details(groupId: number): Promise<GroupDetails> {
    const { data } = await apiClient.get(`/groups/${groupId}`);
    return ZDetails.parse(data);
  },
  /** Friends only; returns what was added and what was skipped (with a code). */
  async addMembers(groupId: number, uniqueIds: string[]) {
    const { data } = await apiClient.post(`/groups/${groupId}/members`, { uniqueIds });
    return z.object({ added: z.array(z.string()), skipped: z.array(z.object({ uniqueId: z.string(), code: z.string() })) }).parse(data);
  },
  async removeMember(groupId: number, uniqueId: string) {
    await apiClient.delete(`/groups/${groupId}/members/${enc(uniqueId)}`);
  },
  async leave(groupId: number) {
    await apiClient.post(`/groups/${groupId}/leave`);
  },
  async transfer(groupId: number, uniqueId: string) {
    await apiClient.post(`/groups/${groupId}/transfer`, { uniqueId });
  },
  async createInvite(groupId: string | number, expiresInSeconds: number) {
    const { data } = await apiClient.post(`/groups/${String(groupId)}/invite`, { expiresInSeconds });
    return data as { token: string; url: string; expiresAt: string };
  },
  async joinByToken(token: string) {
    const { data } = await apiClient.post('/groups/join', { token });
    return data;
  },

  // ---- invitations to a specific person
  async invite(groupId: number, user: Pick<User, 'uniqueId'>) {
    await apiClient.post(`/groups/${groupId}/invitations`, { uniqueId: user.uniqueId });
  },
  async sentInvitations(groupId: number): Promise<SentInvitation[]> {
    const { data } = await apiClient.get(`/groups/${groupId}/invitations`);
    return z.array(ZSent).parse(data);
  },
  async cancelInvitation(groupId: number, invitationId: number) {
    await apiClient.delete(`/groups/${groupId}/invitations/${invitationId}`);
  },
  async myInvitations(): Promise<Invitation[]> {
    const { data } = await apiClient.get('/groups/invitations');
    return z.array(ZInvitation).parse(data);
  },
  async accept(invitationId: number) {
    await apiClient.patch(`/groups/invitations/${invitationId}/accept`);
  },
  async decline(invitationId: number) {
    await apiClient.patch(`/groups/invitations/${invitationId}/decline`);
  },
};
