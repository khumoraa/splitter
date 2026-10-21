import { apiClient } from '@/features/auth/api';
import type { ScanReceiptDto } from '../lib/receipt-calc';

export interface QuotaWindow { used: number; limit: number; remaining: number }
export interface QuotaDto {
  remaining: number;
  limit: number;
  /** ISO time when a recognition becomes available again; null while remaining > 0 */
  resetAt: string | null;
  daily: QuotaWindow;
  monthly: QuotaWindow;
}

export interface ScanResponseDto {
  receipt: ScanReceiptDto;
  /** answered from an earlier result for the same photo: nothing was spent */
  cached: boolean;
  replayed: boolean;
  quota: QuotaDto;
}

export interface ScanRequestInput {
  imageBase64: string;
  mimeType: string;
  language: string;
  /** the user's default currency: used by the server only when the receipt does not say */
  currency: string;
}

// Receipt photos and recognised receipts are never logged here (see also the redaction in the axios interceptors).
export const ScanApi = {
  async quota(signal?: AbortSignal): Promise<QuotaDto> {
    const { data } = await apiClient.get<QuotaDto>('/sessions/scan/quota', { timeout: 10000, ...(signal ? { signal } : {}) });
    return data;
  },

  async scan(input: ScanRequestInput, opts: { signal: AbortSignal; idempotencyKey: string; onUploaded?: () => void }): Promise<ScanResponseDto> {
    const { data } = await apiClient.post<ScanResponseDto>(
      '/sessions/scan',
      { image: { mimeType: input.mimeType, data: input.imageBase64 }, language: input.language, currency: input.currency },
      {
        // the server waits up to 60 s for the model (one attempt + one network retry)
        timeout: 130000,
        signal: opts.signal,
        headers: { 'Idempotency-Key': opts.idempotencyKey },
        onUploadProgress: (e) => {
          if (e.total && e.loaded >= e.total) opts.onUploaded?.();
        },
      }
    );
    return data;
  },
};
