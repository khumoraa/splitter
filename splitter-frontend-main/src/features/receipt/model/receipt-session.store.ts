import { create } from 'zustand';
import { onSessionCleanup } from '@/shared/lib/session-cleanup';
import type {
  FinalizeReceiptResponse,
  FinalizeReceiptItemPayload,
  FinalizeTotalsByItem,
  FinalizeTotalsByParticipant,
  ReceiptParticipant,
  ReceiptSplitMode,
  ReceiptAllocation,
} from '@/features/receipt/api/receipt.api';
import { ReceiptApi } from '@/features/receipt/api/receipt.api';
import { useAppStore } from '@/shared/lib/stores/app-store';

export interface ReceiptSplitItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  kind?: string;
  splitMode: ReceiptSplitMode;
  assignedTo: string[];
  perPersonCount: Record<string, number>;
}

/** A reviewed line handed to the split flow. Tax/tip/discount arrive as lines with a kind. */
export interface ReviewedItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  kind?: string;
}

/** lines that belong to the whole table and are shared by everyone unless the user changes it */
const SHARED_KINDS = new Set(['tax', 'tip', 'discount', 'fee']);

export interface ReceiptSessionMeta {
  /** absent until the bill is finalized: the session is created on the server lazily (see items-split) */
  sessionId?: number;
  sessionName: string;
  language: string;
}

export type FinishPayload = {
  sessionId?: number;
  payer?: { uniqueId: string; username: string } | null;
  sessionName?: string;
  receiptId?: string;
  participants?: ReceiptParticipant[];
  totals?: Record<string, number>;
  totalsByParticipant?: FinalizeTotalsByParticipant[];
  totalsByItem?: FinalizeTotalsByItem[];
  allocations?: ReceiptAllocation[];
  status?: string;
  createdAt?: string;
  grandTotal?: number;
  currency?: string;
};

interface ReceiptSessionStore {
  session?: ReceiptSessionMeta;
  items: ReceiptSplitItem[];
  participants: ReceiptParticipant[];
  currency: string; // ✅ Добавлено поле для валюты
  finalizing: boolean;
  finalizeError?: string;
  finalized?: FinalizeReceiptResponse;
  lastFinishPayload?: FinishPayload;

  setSessionName: (sessionName: string) => void;
  setParticipants: (participants: ReceiptParticipant[]) => void;
  setCurrency: (currency: string) => void; // ✅ Добавлен метод
  updateItem: (itemId: string, updater: (prev: ReceiptSplitItem) => ReceiptSplitItem) => void;
  setItems: (items: ReceiptSplitItem[]) => void;
  /** starts the split flow from the reviewed receipt (scan or manual entry) */
  startFromReview: (input: { sessionName: string; language: string; currency: string; items: ReviewedItem[] }) => void;
  setLastFinishPayload: (payload?: FinishPayload) => void;

  finalizeSession: () => Promise<FinalizeReceiptResponse>;
  reset: () => void;
}

const INITIAL_STATE: Pick<ReceiptSessionStore,
  'session' | 'items' | 'participants' | 'currency' | 'finalizing' | 'finalizeError' | 'finalized' | 'lastFinishPayload'
> = {
  session: undefined,
  items: [],
  participants: [],
  currency: 'UZS', // ✅ Значение по умолчанию
  finalizing: false,
  finalizeError: undefined,
  finalized: undefined,
  lastFinishPayload: undefined,
};

export const useReceiptSessionStore = create<ReceiptSessionStore>((set, get) => ({
  ...INITIAL_STATE,

  setSessionName: (sessionName) => {
    set((state) => {
      if (!state.session) return {};
      return { session: { ...state.session, sessionName } };
    });
  },

  setParticipants: (participants) =>
    set((state) => ({
      participants,
      // tax, tip and discount lines are split equally between everyone who takes part
      items: state.items.map((item) =>
        item.kind && SHARED_KINDS.has(item.kind) && item.assignedTo.length === 0
          ? { ...item, splitMode: 'equal' as const, assignedTo: participants.map((p) => p.uniqueId) }
          : item
      ),
    })),

  startFromReview: ({ sessionName, language, currency, items }) =>
    set({
      session: { sessionName, language },
      items: items.map((item) => ({
        ...item,
        splitMode: item.quantity > 1 && !item.kind ? 'count' : 'equal',
        assignedTo: [],
        perPersonCount: {},
      })),
      participants: [],
      currency,
      finalized: undefined,
      finalizeError: undefined,
    }),

  setCurrency: (currency) => set({ currency }), // ✅ Новый метод

  updateItem: (itemId, updater) => {
    set((state) => ({
      items: state.items.map((item) => item.id === itemId ? updater(item) : item),
    }));
  },

  setItems: (items) => set({ items }),
  setLastFinishPayload: (payload) => set({ lastFinishPayload: payload }),

  finalizeSession: async () => {
    const { session, participants, items, currency } = get();
    if (!session) throw new Error('No session to finalize');
    const sessionId = session.sessionId ?? (await ReceiptApi.createSession()).id;
    if (participants.length === 0) throw new Error('Add at least one participant');

    const payloadItems: FinalizeReceiptItemPayload[] = items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.unitPrice,
      quantity: item.quantity,
      kind: item.kind,
      splitMode: item.splitMode,
      assignedTo: item.splitMode === 'equal' ? item.assignedTo : undefined,
      perPersonCount: item.splitMode === 'count' ? item.perPersonCount : undefined,
    }));

    set({ finalizing: true, finalizeError: undefined });
    try {
      const response = await ReceiptApi.finalize({
        sessionId,
        sessionName: session.sessionName,
        participants,
        items: payloadItems,
        currency,
      });

      const nextState: Partial<ReceiptSessionStore> = {
        finalizing: false,
        finalized: response,
        finalizeError: undefined,
        lastFinishPayload: {
          sessionId: response.sessionId,
          sessionName: response.sessionName,
          payer: response.payer ?? null,
          participants,
          totalsByParticipant: response.totals?.byParticipant,
          totalsByItem: response.totals?.byItem,
          allocations: response.allocations,
          grandTotal: response.totals?.grandTotal,
          currency: response.totals?.currency ?? currency,
          status: response.status,
          createdAt: response.createdAt,
        },
      };

      if (response.totals?.currency) {
        nextState.currency = response.totals.currency;
      }

      set(nextState);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to finalize session';
      set({ finalizing: false, finalizeError: message });
      throw error;
    }
  },

  reset: () => set({ ...INITIAL_STATE, currency: useAppStore.getState().defaultCurrency }),
}));

onSessionCleanup(() => useReceiptSessionStore.getState().reset());
