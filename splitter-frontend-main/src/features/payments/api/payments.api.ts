import { z } from 'zod';
import { apiClient } from '@/features/auth/api';
import { ZUser } from '@/features/friends/model/types';

const ZStatus = z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID_PENDING_CONFIRMATION', 'PAID', 'FORGIVEN', 'CANCELLED']);
const ZRole = z.enum(['debtor', 'creditor', 'participant', 'outsider']);
const ZAction = z.enum(['markPaid', 'recordReceived', 'confirm', 'reject', 'forgive', 'remind']);

export const ZPayment = z.object({
  id: z.number(),
  amountMinor: z.number(),
  method: z.enum(['CASH', 'TRANSFER', 'OTHER']),
  note: z.string().nullable(),
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']),
  recordedBy: ZUser,
  resolvedBy: ZUser.nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type Payment = z.infer<typeof ZPayment>;

export const ZObligation = z.object({
  id: z.number(),
  sessionId: z.number(),
  currency: z.string(),
  amountMinor: z.number(),
  confirmedMinor: z.number(),
  pendingMinor: z.number(),
  outstandingMinor: z.number(),
  status: ZStatus,
  debtor: ZUser,
  creditor: ZUser,
  myRole: ZRole,
  lastReminderAt: z.string().nullable(),
  allowedActions: z.array(ZAction),
  payments: z.array(ZPayment),
  createdAt: z.string(),
  bill: z.object({ id: z.number(), name: z.string().nullable(), date: z.string(), group: z.object({ id: z.number(), name: z.string() }).nullable() }).optional(),
});
export type Obligation = z.infer<typeof ZObligation>;

export const ZEvent = z.object({
  id: z.number(),
  obligationId: z.number(),
  type: z.string(),
  amountMinor: z.number().nullable(),
  paymentId: z.number().nullable(),
  note: z.string().nullable(),
  actor: ZUser,
  createdAt: z.string(),
});
export type LedgerEvent = z.infer<typeof ZEvent>;

const ZTotals = z.object({
  currency: z.string().nullable(),
  amountMinor: z.number(),
  settledMinor: z.number(),
  pendingMinor: z.number(),
  outstandingMinor: z.number(),
  forgivenMinor: z.number(),
});

export const ZLedger = z.object({
  session: z.object({
    id: z.number(),
    name: z.string().nullable(),
    currency: z.string().nullable(),
    finalizedAt: z.string().nullable(),
    createdAt: z.string(),
    payer: ZUser,
    group: z.object({ id: z.number(), name: z.string() }).nullable(),
    grandTotalMinor: z.number().nullable(),
  }),
  obligations: z.array(ZObligation),
  events: z.array(ZEvent),
  totals: ZTotals,
});
export type Ledger = z.infer<typeof ZLedger>;

const ZSidePerson = z.object({ id: z.number(), outstandingMinor: z.number(), settledMinor: z.number(), count: z.number(), user: ZUser.nullable() });
const ZSide = z.object({ outstandingMinor: z.number(), settledMinor: z.number(), forgivenMinor: z.number(), count: z.number(), people: z.array(ZSidePerson) });
export const ZCurrencySummary = z.object({ currency: z.string(), owedToMe: ZSide, iOwe: ZSide, netMinor: z.number(), minorPerUnit: z.number() });
export type CurrencySummary = z.infer<typeof ZCurrencySummary>;

export const ZSummary = z.object({
  currencies: z.array(ZCurrencySummary),
  groups: z.array(z.object({ group: z.object({ id: z.number(), name: z.string() }), currency: z.string(), totalMinor: z.number(), settledMinor: z.number() })),
});
export type Summary = z.infer<typeof ZSummary>;

export const ZPersonDetail = z.object({ person: ZUser, currencies: z.array(ZCurrencySummary), obligations: z.array(ZObligation) });
export type PersonDetail = z.infer<typeof ZPersonDetail>;

export const ZBillStatement = z.object({
  kind: z.literal('bill'),
  statementId: z.string(),
  generatedAt: z.string(),
  legalNote: z.string(),
  bill: ZLedger.shape.session,
  currency: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), kind: z.string().nullable(), totalMinor: z.number() })),
  shares: z.array(z.object({ uniqueId: z.string(), username: z.string(), amountMinor: z.number() })),
  obligations: z.array(z.object({ id: z.number(), debtor: ZUser, creditor: ZUser, amountMinor: z.number(), settledMinor: z.number(), pendingMinor: z.number(), outstandingMinor: z.number(), status: ZStatus, payments: z.array(ZPayment) })),
  totals: ZTotals,
});
export type BillStatement = z.infer<typeof ZBillStatement>;

export type Filters = { status?: string; from?: string; to?: string; groupId?: number; person?: string; currency?: string; role?: 'creditor' | 'debtor' };
const params = (f: Filters = {}) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ''));

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'OTHER';

export const PaymentsApi = {
  async ledger(sessionId: number, signal?: AbortSignal) {
    const { data } = await apiClient.get(`/obligations/session/${sessionId}`, signal ? { signal } : {});
    return ZLedger.parse(data);
  },
  async summary(f?: Filters) {
    const { data } = await apiClient.get('/obligations/summary', { params: params(f) });
    return ZSummary.parse(data);
  },
  async list(f?: Filters) {
    const { data } = await apiClient.get('/obligations', { params: params(f) });
    return z.object({ obligations: z.array(ZObligation) }).parse(data).obligations;
  },
  async person(uniqueId: string) {
    const { data } = await apiClient.get(`/obligations/people/${encodeURIComponent(uniqueId)}`);
    return ZPersonDetail.parse(data);
  },
  async billStatement(sessionId: number) {
    const { data } = await apiClient.get(`/obligations/session/${sessionId}/statement`);
    return ZBillStatement.parse(data);
  },
  /** "I paid" (debtor, awaits confirmation) or "Received" (creditor). The key makes a double tap harmless. */
  async pay(obligationId: number, body: { amountMinor?: number; method: PaymentMethod; note?: string }, idempotencyKey: string) {
    const { data } = await apiClient.post(`/obligations/${obligationId}/payments`, body, { headers: { 'Idempotency-Key': idempotencyKey } });
    return data as { payment: { id: number; status: string; amountMinor: number }; replayed: boolean };
  },
  async confirm(obligationId: number, paymentId: number) {
    await apiClient.post(`/obligations/${obligationId}/payments/${paymentId}/confirm`);
  },
  async reject(obligationId: number, paymentId: number, reason: string) {
    await apiClient.post(`/obligations/${obligationId}/payments/${paymentId}/reject`, { reason });
  },
  async forgive(obligationId: number, note?: string) {
    await apiClient.post(`/obligations/${obligationId}/forgive`, note ? { note } : {});
  },
  async remind(obligationId: number) {
    const { data } = await apiClient.post(`/obligations/${obligationId}/remind`);
    return data as { lastReminderAt: string };
  },
};
