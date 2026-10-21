/**
 * How a status is shown: ALWAYS an icon and a text, the colour only adds to them (never the only signal). Pure.
 */
import type { ObligationStatus } from './rules';

export type Tone = 'success' | 'warning' | 'neutral' | 'muted' | 'danger';
export type StatusIcon = 'check' | 'clock' | 'circle' | 'half' | 'gift' | 'x';

export interface StatusLook { icon: StatusIcon; labelKey: string; tone: Tone }

export function obligationLook(s: ObligationStatus): StatusLook {
  switch (s) {
    case 'PAID': return { icon: 'check', labelKey: 'payments.status.PAID', tone: 'success' };
    case 'PAID_PENDING_CONFIRMATION': return { icon: 'clock', labelKey: 'payments.status.PAID_PENDING_CONFIRMATION', tone: 'warning' };
    case 'PARTIALLY_PAID': return { icon: 'half', labelKey: 'payments.status.PARTIALLY_PAID', tone: 'warning' };
    case 'FORGIVEN': return { icon: 'gift', labelKey: 'payments.status.FORGIVEN', tone: 'muted' };
    case 'CANCELLED': return { icon: 'x', labelKey: 'payments.status.CANCELLED', tone: 'muted' };
    default: return { icon: 'circle', labelKey: 'payments.status.UNPAID', tone: 'danger' };
  }
}

export type BillPaymentState = 'paid' | 'partial' | 'unpaid' | 'none';

export function billLook(s: BillPaymentState): StatusLook | null {
  switch (s) {
    case 'paid': return { icon: 'check', labelKey: 'payments.bill.paid', tone: 'success' };
    case 'partial': return { icon: 'half', labelKey: 'payments.bill.partial', tone: 'warning' };
    case 'unpaid': return { icon: 'circle', labelKey: 'payments.bill.unpaid', tone: 'danger' };
    default: return null;
  }
}

/** Event types of the audit log -> text keys. Unknown types still render (generic text), never crash. */
export const EVENT_KEYS: Record<string, string> = {
  CREATED: 'payments.event.CREATED',
  PAYMENT_MARKED: 'payments.event.PAYMENT_MARKED',
  PAYMENT_RECORDED: 'payments.event.PAYMENT_RECORDED',
  PAYMENT_CONFIRMED: 'payments.event.PAYMENT_CONFIRMED',
  PAYMENT_REJECTED: 'payments.event.PAYMENT_REJECTED',
  FORGIVEN: 'payments.event.FORGIVEN',
  CANCELLED: 'payments.event.CANCELLED',
  REMINDER_SENT: 'payments.event.REMINDER_SENT',
};
export const eventKey = (type: string) => EVENT_KEYS[type] ?? 'payments.event.OTHER';
