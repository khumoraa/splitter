import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Draft } from '../lib/receipt-calc';

/**
 * The receipt being edited. Persisted, so edits survive the app going to the background or being killed.
 * Contains the parsed receipt text and amounts only: never the photo.
 */
interface DraftStore {
  draft: Draft | null;
  /** AsyncStorage has been read; screens must wait for it before deciding "no draft" */
  hydrated: boolean;
  /** server idempotency key + fingerprint of the photo being recognised (not persisted) */
  setDraft: (draft: Draft | null) => void;
  update: (fn: (d: Draft) => Draft) => void;
  clear: () => void;
}

export const useDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      draft: null,
      hydrated: false,
      setDraft: (draft) => set({ draft }),
      update: (fn) => {
        const d = get().draft;
        if (d) set({ draft: { ...fn(d), updatedAt: Date.now() } });
      },
      clear: () => set({ draft: null }),
    }),
    {
      name: 'receipt-draft-v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ draft: s.draft }),
      onRehydrateStorage: () => () => {
        useDraftStore.setState({ hydrated: true });
      },
    }
  )
);
