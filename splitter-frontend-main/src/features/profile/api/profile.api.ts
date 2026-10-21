import { apiClient, type User } from '@/features/auth/api';
import type { ProfileApi } from '../lib/profile-actions';

/**
 * Network layer of the profile section. Every call that changes the profile returns the FULL profile from the server,
 * which the caller puts into the store (no partial objects, no placeholder avatars: avatarUrl is a URL or null).
 */
export const profileApi: ProfileApi & { exportMyData(): Promise<unknown> } = {
  async updateUsername(username) {
    const { data } = await apiClient.patch<User>('/user/username', { username });
    return data;
  },

  async updateEmail(email, currentPassword) {
    const { data } = await apiClient.patch<User>('/user/email', { email, currentPassword });
    return data;
  },

  async changePassword(currentPassword, newPassword) {
    await apiClient.patch('/user/password', { currentPassword, newPassword });
  },

  async uploadAvatar(file, onProgress) {
    const form = new FormData();
    // React Native's FormData takes { uri, name, type } and streams the file from disk.
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    const { data } = await apiClient.post<{ user: User }>('/uploads/avatar', form, {
      timeout: 120_000,
      // no Content-Type here on purpose: the request interceptor removes it for FormData so the boundary is added natively
      onUploadProgress: (e) => {
        if (e.total) onProgress?.(Math.min(100, Math.round((e.loaded * 100) / e.total)));
      },
    });
    return data.user;
  },

  async removeAvatar() {
    const { data } = await apiClient.delete<{ user: User }>('/users/me/avatar');
    return data.user;
  },

  async deleteAccount(password) {
    await apiClient.delete('/users/me', { data: { password } });
  },

  async exportMyData() {
    const { data } = await apiClient.get('/users/me/export');
    return data;
  },
};
