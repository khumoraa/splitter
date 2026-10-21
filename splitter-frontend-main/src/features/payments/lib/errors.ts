/** Translation key for a failed payment action (server codes first, then the shared social mapping). Pure. */
import { socialErrorKey, type Failure } from '../../social/lib/errors.ts';

export const PAYMENT_ERROR_CODES = ['OVERPAYMENT', 'OBLIGATION_CLOSED', 'PAYMENT_NOT_PENDING', 'PENDING_PAYMENTS', 'REMINDER_TOO_SOON', 'SESSION_LOCKED'] as const;

export function paymentErrorKey(f: Failure): string {
  if (f.code && (PAYMENT_ERROR_CODES as readonly string[]).includes(f.code)) return `payments.errors.${f.code}`;
  return socialErrorKey(f);
}
