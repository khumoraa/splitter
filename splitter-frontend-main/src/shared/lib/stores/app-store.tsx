import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentUser } from '@/features/auth/api';
import { isUnauthorized } from '@/shared/api/api-error';
import { getToken, removeToken } from '../utils/token-storage';
import type { LanguageCode } from '@/shared/config/languages';
import { DEVICE_LANGUAGE } from '@/shared/config/device-language';

// Provider component for initialization
import { ReactNode, useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { onUnauthorized, resetUnauthorizedCooldown } from '@/shared/api/auth-events';

export interface User {
  id: number;
  email: string;
  username: string;
  uniqueId: string;
  avatarUrl: string | null;
}

interface AppStore {
  // Auth state
  token: string | null;
  user: User | null;
  isLoading: boolean;
  /** true once the stored token has been read (so screens don't flash Welcome before autologin) */
  authReady: boolean;
  
  // App settings
  theme: 'light' | 'dark';
  language: LanguageCode;
  
  // Actions
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  setAuth: (token: string, user: User) => void;
  logout: () => Promise<void>;
  initializeAuth: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  setLanguage: (language: LanguageCode) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Initial state
      token: null,
      user: null,
      isLoading: false,
      authReady: false,
      theme: 'light',
      // first launch follows the phone's language; a saved choice replaces it when the store is rehydrated
      language: DEVICE_LANGUAGE,

      // Auth actions
      setToken: (token: string) => {
        set({ token });
      },

      setUser: (user: User) => {
        set({ user });
      },

      setAuth: (token: string, user: User) => {
        resetUnauthorizedCooldown();
        set({ token, user });
      },

      logout: async () => {
        try {
          await removeToken();
          set({ token: null, user: null });
        } catch (error) {
          console.error('Logout error:', error);
        }
      },

      initializeAuth: async () => {
        set({ isLoading: true });
        try {
          const token = await getToken();
          if (!token) {
            set({ token: null, user: null, authReady: true });
            return;
          }

          // token is known: navigate right away, the profile loads in the background
          set({ token, authReady: true });

          try {
            const currentUser = await getCurrentUser(token);
            set({ user: currentUser });
          } catch (error) {
            // An invalid/expired token (401) is an expected case handled just below: warn, not error
            // (console.error opens the red error overlay in dev builds). Real failures stay errors.
            if (isUnauthorized(error)) {
              console.warn('Current user fetch: token is no longer valid, signing out');
            } else {
              console.error('Current user fetch error:', error);
            }
            set({ user: null });

            if (isUnauthorized(error)) {
              await removeToken();
              set({ token: null, user: null });
            }
          }
        } catch (error) {
          console.error('Auth initialization error:', error);
          set({ token: null, user: null });
        } finally {
          set({ isLoading: false, authReady: true });
        }
      },

      // App settings actions
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'app-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        // Не сохраняем токен и пользователя в AsyncStorage, 
        // так как токен сохраняется отдельно в SecureStore
      }),
    }
  )
);

/** true once the persisted settings (language, theme) are loaded from AsyncStorage. */
export function useStoreHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useAppStore.persist.onFinishHydration(onChange),
    () => useAppStore.persist.hasHydrated(),
    () => false
  );
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const initializeAuth = useAppStore((s) => s.initializeAuth);
  const logout = useAppStore((s) => s.logout);
  const router = useRouter();
  
  useEffect(() => {
    initializeAuth();
  }, []);

  useEffect(() => {
    const unsubscribe = onUnauthorized(async () => {
      await logout();
      router.replace('/');
    });
    return unsubscribe;
  }, [logout, router]);
  
  return <>{children}</>;
}
