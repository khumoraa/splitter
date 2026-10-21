import { useMemo } from 'react';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { createProfileActions } from '../lib/profile-actions';
import { profileApi } from '../api/profile.api';

/** The profile actions wired to the real API and the app store. */
export function useProfileActions() {
  return useMemo(
    () =>
      createProfileActions({
        api: profileApi,
        getUser: () => useAppStore.getState().user,
        setUser: (user) => useAppStore.getState().setUser(user),
        logout: () => useAppStore.getState().logout(),
      }),
    []
  );
}
