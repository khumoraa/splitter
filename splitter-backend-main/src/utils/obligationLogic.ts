/**
 * Rules of payment tracking. Pure module (no imports): the server enforces them, the client mirrors them for buttons.
 * The app never moves money; these are records of debts and of settlements made outside the app.
 * All amounts are integer minor units of the obligation's currency.
 */
export type ObligationStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID_PENDING_CONFIRMATION" | "PAID" | "FORGIVEN" | "CANCELLED";
export type Role = "debtor" | "creditor" | "participant" | "outsider";
export type Action = "markPaid" | "recordReceived" | "confirm" | "reject" | "forgive" | "remind";

export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_NOTE_LEN = 200;

export interface Amounts { amountMinor: number; confirmedMinor: number; pendingMinor: number }

export const isTerminal = (s: ObligationStatus) => s === "FORGIVEN" || s === "CANCELLED";

/** Status from the payment totals; FORGIVEN / CANCELLED are final and kept as they are. */
export function deriveStatus(a: Amounts, current?: ObligationStatus): ObligationStatus {
  if (current && isTerminal(current)) return current;
  if (a.confirmedMinor >= a.amountMinor) return "PAID";
  if (a.pendingMinor > 0) return "PAID_PENDING_CONFIRMATION";
  if (a.confirmedMinor > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}

/** What can still be recorded: the debt minus confirmed and pending payments. */
export const recordableMinor = (a: Amounts) => Math.max(0, a.amountMinor - a.confirmedMinor - a.pendingMinor);

/** What is still owed (pending payments are not yet money received). Zero once forgiven or cancelled. */
export const outstandingMinor = (a: Amounts, status: ObligationStatus) => (isTerminal(status) ? 0 : Math.max(0, a.amountMinor - a.confirmedMinor));

/** Who may do what. The bill creator who is not the creditor is only a "participant" here. */
export function can(role: Role, action: Action): boolean {
  switch (action) {
    case "markPaid": return role === "debtor";
    case "recordReceived":
    case "confirm":
    case "reject":
    case "forgive":
    case "remind": return role === "creditor";
  }
}

export type AmountProblem = "VALIDATION" | "OVERPAYMENT" | "OBLIGATION_CLOSED";

/** Checks a new payment; `amountMinor` undefined means "the rest". Returns the amount to record or the problem. */
export function checkPayment(a: Amounts, status: ObligationStatus, amountMinor: number | undefined): { ok: true; amountMinor: number } | { ok: false; code: AmountProblem } {
  if (isTerminal(status) || status === "PAID") return { ok: false, code: "OBLIGATION_CLOSED" };
  const room = recordableMinor(a);
  if (amountMinor === undefined) return room > 0 ? { ok: true, amountMinor: room } : { ok: false, code: "OVERPAYMENT" };
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, code: "VALIDATION" };
  if (amountMinor > room) return { ok: false, code: "OVERPAYMENT" };
  return { ok: true, amountMinor };
}

export function reminderAllowed(lastReminderAt: number | null, now: number): { ok: true } | { ok: false; retryAt: number } {
  if (lastReminderAt === null || now - lastReminderAt >= REMINDER_INTERVAL_MS) return { ok: true };
  return { ok: false, retryAt: lastReminderAt + REMINDER_INTERVAL_MS };
}

// ---------------------------------------------------------------- creating obligations from a split

export interface Desired { debtorId: number; creditorId: number; amountMinor: number; currency: string }

/**
 * Everyone owes the payer their share. A negative share (a discount bigger than what someone ordered) means the payer
 * owes that person. The payer's own share and zero shares create nothing; duplicate people are merged.
 */
export function obligationsFromShares(shares: { userId: number; minor: number }[], payerId: number, currency: string): Desired[] {
  const byUser = new Map<number, number>();
  for (const s of shares) {
    if (s.userId === payerId || !Number.isInteger(s.minor)) continue;
    byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + s.minor);
  }
  const out: Desired[] = [];
  for (const [userId, minor] of byUser) {
    if (minor === 0) continue;
    out.push(minor > 0
      ? { debtorId: userId, creditorId: payerId, amountMinor: minor, currency }
      : { debtorId: payerId, creditorId: userId, amountMinor: -minor, currency });
  }
  return out;
}

export interface Existing extends Desired { id: number; status: ObligationStatus; hasPayments: boolean }

/**
 * Re-finalizing a bill: identical live obligations stay; changed ones are cancelled and recreated, but only while
 * nobody has recorded a payment on them; otherwise the change is refused (locked) instead of rewriting history.
 */
export function planSync(existing: Existing[], desired: Desired[]): { keep: number[]; cancel: number[]; create: Desired[]; locked: boolean } {
  const live = existing.filter((e) => e.status !== "CANCELLED");
  const same = (e: Desired, d: Desired) => e.debtorId === d.debtorId && e.creditorId === d.creditorId && e.amountMinor === d.amountMinor && e.currency === d.currency;
  const keep: number[] = [];
  const create: Desired[] = [];
  const matched = new Set<number>();
  for (const d of desired) {
    const hit = live.find((e) => !matched.has(e.id) && same(e, d));
    if (hit) { matched.add(hit.id); keep.push(hit.id); } else create.push(d);
  }
  const cancel = live.filter((e) => !matched.has(e.id));
  const locked = cancel.some((e) => e.hasPayments || e.status !== "UNPAID");
  return { keep, cancel: cancel.map((e) => e.id), create, locked };
}

// ---------------------------------------------------------------- summaries (never mixing currencies)

export interface SummaryRow {
  currency: string;
  /** from the viewer's side */
  direction: "owedToMe" | "iOwe";
  counterpartId: number;
  amountMinor: number;
  confirmedMinor: number;
  status: ObligationStatus;
}

export interface Side { outstandingMinor: number; settledMinor: number; forgivenMinor: number; count: number; people: { id: number; outstandingMinor: number; settledMinor: number; count: number }[] }
export interface CurrencySummary { currency: string; owedToMe: Side; iOwe: Side; netMinor: number }

const emptySide = (): Side => ({ outstandingMinor: 0, settledMinor: 0, forgivenMinor: 0, count: 0, people: [] });

export function summarize(rows: SummaryRow[]): CurrencySummary[] {
  const byCur = new Map<string, CurrencySummary>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const cs = byCur.get(r.currency) ?? { currency: r.currency, owedToMe: emptySide(), iOwe: emptySide(), netMinor: 0 };
    byCur.set(r.currency, cs);
    const side = cs[r.direction];
    const out = outstandingMinor({ amountMinor: r.amountMinor, confirmedMinor: r.confirmedMinor, pendingMinor: 0 }, r.status);
    side.outstandingMinor += out;
    side.settledMinor += r.confirmedMinor;
    if (r.status === "FORGIVEN") side.forgivenMinor += Math.max(0, r.amountMinor - r.confirmedMinor);
    side.count++;
    let p = side.people.find((x) => x.id === r.counterpartId);
    if (!p) { p = { id: r.counterpartId, outstandingMinor: 0, settledMinor: 0, count: 0 }; side.people.push(p); }
    p.outstandingMinor += out;
    p.settledMinor += r.confirmedMinor;
    p.count++;
  }
  const list = [...byCur.values()];
  for (const cs of list) {
    cs.netMinor = cs.owedToMe.outstandingMinor - cs.iOwe.outstandingMinor;
    for (const side of [cs.owedToMe, cs.iOwe]) side.people.sort((a, b) => b.outstandingMinor - a.outstandingMinor || a.id - b.id);
  }
  return list.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** Bill-level payment state for a history entry, from the viewer's obligations in it. */
export function paymentState(rows: { status: ObligationStatus; amountMinor: number; confirmedMinor: number }[]): "none" | "paid" | "partial" | "unpaid" {
  const live = rows.filter((r) => r.status !== "CANCELLED");
  if (live.length === 0) return "none";
  const closed = (s: ObligationStatus) => s === "PAID" || s === "FORGIVEN";
  if (live.every((r) => closed(r.status))) return "paid";
  if (live.some((r) => r.confirmedMinor > 0 || closed(r.status) || r.status === "PAID_PENDING_CONFIRMATION")) return "partial";
  return "unpaid";
}
