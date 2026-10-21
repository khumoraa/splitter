/**
 * Client mirror of the server's payment rules (splitter-backend/src/utils/obligationLogic.ts), used to decide which
 * buttons to show. The server always re-checks; rules.test.mjs compares both modules on every combination.
 */
export type ObligationStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID_PENDING_CONFIRMATION' | 'PAID' | 'FORGIVEN' | 'CANCELLED';
export type Role = 'debtor' | 'creditor' | 'participant' | 'outsider';
export type Action = 'markPaid' | 'recordReceived' | 'confirm' | 'reject' | 'forgive' | 'remind';

export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_NOTE_LEN = 200;

export interface Amounts { amountMinor: number; confirmedMinor: number; pendingMinor: number }

export const isTerminal = (s: ObligationStatus) => s === 'FORGIVEN' || s === 'CANCELLED';
export const isClosed = (s: ObligationStatus) => isTerminal(s) || s === 'PAID';

export function deriveStatus(a: Amounts, current?: ObligationStatus): ObligationStatus {
  if (current && isTerminal(current)) return current;
  if (a.confirmedMinor >= a.amountMinor) return 'PAID';
  if (a.pendingMinor > 0) return 'PAID_PENDING_CONFIRMATION';
  if (a.confirmedMinor > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

export const recordableMinor = (a: Amounts) => Math.max(0, a.amountMinor - a.confirmedMinor - a.pendingMinor);
export const outstandingMinor = (a: Amounts, status: ObligationStatus) => (isTerminal(status) ? 0 : Math.max(0, a.amountMinor - a.confirmedMinor));

export function can(role: Role, action: Action): boolean {
  switch (action) {
    case 'markPaid': return role === 'debtor';
    default: return role === 'creditor';
  }
}

/** Buttons for one debt as seen by `role` (matches the server's `allowedActions`). */
export function allowedActions(role: Role, status: ObligationStatus, hasPending: boolean, a?: Amounts): Action[] {
  if (isClosed(status)) return [];
  const all: Action[] = ['markPaid', 'recordReceived', 'confirm', 'reject', 'forgive', 'remind'];
  return all.filter((x) => {
    if (!can(role, x)) return false;
    if (x === 'confirm' || x === 'reject') return hasPending;
    // nothing left to mark or record while the rest is waiting for confirmation
    if ((x === 'markPaid' || x === 'recordReceived') && a) return recordableMinor(a) > 0;
    return true;
  });
}

export function checkAmount(a: Amounts, status: ObligationStatus, amountMinor: number | undefined): { ok: true; amountMinor: number } | { ok: false; code: 'VALIDATION' | 'OVERPAYMENT' | 'OBLIGATION_CLOSED' } {
  if (isClosed(status)) return { ok: false, code: 'OBLIGATION_CLOSED' };
  const room = recordableMinor(a);
  if (amountMinor === undefined) return room > 0 ? { ok: true, amountMinor: room } : { ok: false, code: 'OVERPAYMENT' };
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, code: 'VALIDATION' };
  if (amountMinor > room) return { ok: false, code: 'OVERPAYMENT' };
  return { ok: true, amountMinor };
}

/** When the next reminder is possible (null = now). */
export function nextReminderAt(lastReminderAt: string | null | undefined, now: number): number | null {
  if (!lastReminderAt) return null;
  const at = new Date(lastReminderAt).getTime() + REMINDER_INTERVAL_MS;
  return Number.isFinite(at) && at > now ? at : null;
}
