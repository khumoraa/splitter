import { apiClient } from '@/features/auth/api';
import { logLevelForStatus, isApiError } from '@/shared/api/api-error';

export type ParsedReceiptItemKind = 'item' | 'fee' | 'tax' | 'tip' | 'discount' | string;


export type ReceiptParticipant = {
  uniqueId: string;
  username: string;
};

export type ReceiptSplitMode = 'equal' | 'count';

export interface FinalizeReceiptItemPayload {
  id: string;
  name: string;
  price: number;
  quantity: number;
  kind?: ParsedReceiptItemKind;
  splitMode: ReceiptSplitMode;
  assignedTo?: string[];
  perPersonCount?: Record<string, number>;
}

export interface FinalizeReceiptRequest {
  sessionId: number;
  sessionName: string;
  participants: ReceiptParticipant[];
  items: FinalizeReceiptItemPayload[];
  currency?: string; // ✅ Добавьте валюту в запрос
}

export interface FinalizeTotalsByParticipant {
  uniqueId: string;
  username: string;
  amountOwed: number;
}

export interface FinalizeTotalsByItem {
  itemId: string;
  name: string;
  total: number;
}

export interface ReceiptAllocation {
  itemId: string;
  participantId: string;
  shareAmount: number;
  shareUnits?: number;
  shareRatio?: number;
}

export interface FinalizeReceiptResponse {
  sessionId: number;
  /** the session creator, who paid the bill */
  payer?: { uniqueId: string; username: string } | null;
  sessionName: string;
  status: string;
  createdAt: string;
  totals: {
    grandTotal: number;
    currency?: string; // ✅ Добавьте валюту в ответ
    byParticipant?: FinalizeTotalsByParticipant[];
    byItem?: FinalizeTotalsByItem[];
  };
  allocations?: ReceiptAllocation[];
}

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error('Unexpected error');
};

export const ReceiptApi = {
  /** Creates the (empty) bill on the server. Done at the last step, so a receipt that is never finished leaves nothing behind. */
  async createSession(): Promise<{ id: number }> {
    const { data } = await apiClient.post<{ id: number }>('/sessions', {});
    return data;
  },

  async finalize(payload: FinalizeReceiptRequest): Promise<FinalizeReceiptResponse> {
    try {
      if (__DEV__) console.log('[API] POST /sessions/finalize');
      if (__DEV__) console.log('[API] Request data:', JSON.stringify(payload, null, 2));

      const { data } = await apiClient.post<FinalizeReceiptResponse>('/sessions/finalize', payload);

      if (__DEV__) console.log('[API] Response:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      // a rejected bill (400) is an expected outcome the UI explains; only real failures are errors
      console[isApiError(error) ? logLevelForStatus(error.status) : 'error']('[API] finalize failed');
      throw normalizeError(error);
    }
  },
};

