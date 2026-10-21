/** Turns statement data from the API into the neutral document model (translations and formatting injected). Pure. */
import type { StatementModel, StatementSection } from './statement';
import { LEGAL_NOTE_KEY } from './statement';

type T = (key: string, opts?: Record<string, unknown>) => string;
type Fmt = (minor: number) => string;
type User = { username: string };

export interface BillData {
  statementId: string;
  generatedAt: string;
  bill: { name: string | null; finalizedAt: string | null; createdAt: string; payer: User; group: { name: string } | null };
  items: { name: string; kind: string | null; totalMinor: number }[];
  shares: { username: string; amountMinor: number }[];
  obligations: { debtor: User; creditor: User; amountMinor: number; settledMinor: number; outstandingMinor: number; status: string; payments: { amountMinor: number; method: string; status: string; createdAt: string; recordedBy: User }[] }[];
  totals: { amountMinor: number; settledMinor: number; pendingMinor: number; outstandingMinor: number; forgivenMinor: number };
}

export function billStatementModel(d: BillData, t: T, fmt: Fmt, date: (iso: string) => string): StatementModel {
  const kindLabel = (k: string | null) => (k === 'tax' ? ` (${t('payments.statement.tax')})` : k === 'tip' ? ` (${t('payments.statement.tip')})` : k === 'discount' ? ` (${t('payments.statement.discount')})` : '');
  const sections: StatementSection[] = [
    {
      title: t('payments.statement.bill'),
      rows: [
        { label: t('payments.statement.billName'), value: d.bill.name || '—' },
        { label: t('payments.statement.date'), value: date(d.bill.finalizedAt ?? d.bill.createdAt) },
        { label: t('payments.statement.paidBy'), value: d.bill.payer.username },
        ...(d.bill.group ? [{ label: t('payments.statement.group'), value: d.bill.group.name }] : []),
      ],
    },
    { title: t('payments.statement.items'), rows: d.items.map((i) => ({ label: i.name + kindLabel(i.kind), value: fmt(i.totalMinor) })) },
    { title: t('payments.statement.shares'), rows: d.shares.map((s) => ({ label: s.username, value: fmt(s.amountMinor) })) },
    {
      title: t('payments.statement.debts'),
      rows: d.obligations.map((o) => ({
        label: `${o.debtor.username} → ${o.creditor.username} · ${t(`payments.status.${o.status}`)}`,
        value: `${fmt(o.amountMinor)} · ${t('payments.statement.left', { amount: fmt(o.outstandingMinor) })}`,
      })),
    },
    {
      title: t('payments.statement.payments'),
      rows: d.obligations.flatMap((o) =>
        o.payments.map((p) => ({
          label: `${date(p.createdAt)} · ${p.recordedBy.username} · ${t(`payments.method.${p.method}`)} · ${t(`payments.paymentStatus.${p.status}`)}`,
          value: fmt(p.amountMinor),
          muted: p.status === 'REJECTED',
        }))
      ),
    },
    {
      title: t('payments.statement.totals'),
      rows: [
        { label: t('payments.statement.totalDebts'), value: fmt(d.totals.amountMinor) },
        { label: t('payments.statement.settled'), value: fmt(d.totals.settledMinor) },
        ...(d.totals.forgivenMinor ? [{ label: t('payments.statement.forgiven'), value: fmt(d.totals.forgivenMinor) }] : []),
        { label: t('payments.statement.outstanding'), value: fmt(d.totals.outstandingMinor), strong: true },
      ],
    },
  ];
  return {
    title: t('payments.statement.title'),
    subtitle: d.bill.name || t('payments.statement.untitled'),
    shortId: d.statementId,
    generatedAt: t('payments.statement.generated', { date: date(d.generatedAt) }),
    sections,
    legalNote: t(LEGAL_NOTE_KEY),
    signature: t('payments.statement.signature'),
  };
}
