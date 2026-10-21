/**
 * Pure calculations for the receipt being edited (review / manual entry). No React, no network.
 * ALL money is integer MINOR units of the receipt currency (cents; whole units for zero-decimal currencies such as
 * JPY/UZS), so totals add up exactly. Percentages are stored as basis points (1000 = 10%) and resolved to minor units
 * once, with Math.round, on the subtotal. Nothing is rounded for display: the numbers shown are the numbers summed.
 * Mirrors splitter-backend/src/utils/scanMath.ts (same zero-decimal currency list).
 */
import { currencyFractionDigits } from '../../../shared/lib/utils/money.ts';

export type AdjustmentMode = 'amount' | 'percent';

export interface Adjustment {
  mode: AdjustmentMode;
  amountMinor: number;
  /** basis points: 1000 = 10%, 1050 = 10.5% */
  percentBp: number;
}

export interface DraftItem {
  id: string;
  name: string;
  /** integer >= 1 */
  quantity: number;
  unitMinor: number;
  /** 0..1, 1 for items typed by hand; < LOW_CONFIDENCE is highlighted */
  confidence: number;
}

export type DraftWarning =
  | { code: 'TOTAL_MISMATCH'; differenceMinor: number }
  | { code: 'LINE_MISMATCH'; itemIndexes: number[] }
  | { code: 'NO_TOTAL' };

export interface Draft {
  source: 'scan' | 'manual';
  merchant: string;
  /** YYYY-MM-DD or null */
  date: string | null;
  currency: string;
  items: DraftItem[];
  tax: Adjustment;
  tip: Adjustment;
  discount: Adjustment;
  /** the total printed on the receipt, used only to reconcile; null = not provided */
  receiptTotalMinor: number | null;
  /** the photo was recognised before: this result came from the cache and cost nothing */
  fromCache?: boolean;
  updatedAt: number;
}

export const LOW_CONFIDENCE = 0.6;
export const MAX_ITEMS = 200;
export const MAX_QUANTITY = 1000;
export const MAX_MINOR = 1_000_000_000_00;

export const zeroAdjustment = (): Adjustment => ({ mode: 'amount', amountMinor: 0, percentBp: 0 });

export function emptyDraft(currency: string, source: Draft['source'], now = Date.now()): Draft {
  return {
    source,
    merchant: '',
    date: null,
    currency,
    items: [],
    tax: zeroAdjustment(),
    tip: zeroAdjustment(),
    discount: zeroAdjustment(),
    receiptTotalMinor: null,
    updatedAt: now,
  };
}

// ---------- currency-aware minor units ----------
const factor = (currency: string) => (currencyFractionDigits(currency) === 0 ? 1 : 100);

export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) throw new RangeError('Not a finite amount');
  return Math.round(Number((amount * factor(currency)).toPrecision(12)));
}

export function minorToMajor(minor: number, currency: string): number {
  return minor / factor(currency);
}

/** "12,50" / "12.50" / "1 250" typed by the user -> minor units; null if not a valid non-negative amount. */
export function parseMinorInput(text: string, currency: string): number | null {
  const s = String(text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const minor = toMinorUnits(n, currency);
  return minor >= 0 && minor <= MAX_MINOR ? minor : null;
}

/** minor units -> text for an input field (no grouping, '.' decimal mark, no trailing zeros noise). */
export function formatMinorInput(minor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  if (digits === 0) return String(minor);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${minor < 0 ? '-' : ''}${whole}${cents ? '.' + String(cents).padStart(2, '0').replace(/0$/, '') : ''}`;
}

/** Localised display, e.g. "$12.50", "¥1,500", "UZS 45,000". Falls back to plain digits if Intl lacks the currency. */
export function formatMinor(minor: number, currency: string, locale?: string): string {
  const digits = currencyFractionDigits(currency);
  const value = minor / (digits === 0 ? 1 : 100);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** "10.5" typed in a percent field -> 1050 basis points; null when invalid or > 100%. */
export function parsePercentInput(text: string): number | null {
  const s = String(text ?? '').replace(/[\s%]/g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}
export const formatPercentInput = (bp: number): string => String(bp / 100);

// ---------- totals ----------
export const lineMinor = (item: Pick<DraftItem, 'quantity' | 'unitMinor'>): number => item.quantity * item.unitMinor;

export const subtotalMinor = (items: readonly DraftItem[]): number => items.reduce((s, i) => s + lineMinor(i), 0);

export function resolveAdjustment(adj: Adjustment, baseMinor: number): number {
  return adj.mode === 'percent' ? Math.round((baseMinor * adj.percentBp) / 10000) : adj.amountMinor;
}

export interface Totals {
  subtotal: number;
  tax: number;
  tip: number;
  discount: number;
  total: number;
}

/** total = subtotal + tax + tip - discount; percentages are taken from the subtotal. */
export function computeTotals(draft: Pick<Draft, 'items' | 'tax' | 'tip' | 'discount'>): Totals {
  const subtotal = subtotalMinor(draft.items);
  const tax = resolveAdjustment(draft.tax, subtotal);
  const tip = resolveAdjustment(draft.tip, subtotal);
  const discount = resolveAdjustment(draft.discount, subtotal);
  return { subtotal, tax, tip, discount, total: subtotal + tax + tip - discount };
}

export type Reconciliation = { state: 'none' } | { state: 'match' } | { state: 'mismatch'; differenceMinor: number };

/** difference = printed total - computed total (positive: the receipt says more than the lines add up to). */
export function reconcileDraft(draft: Draft): Reconciliation {
  if (draft.receiptTotalMinor == null) return { state: 'none' };
  const diff = draft.receiptTotalMinor - computeTotals(draft).total;
  return diff === 0 ? { state: 'match' } : { state: 'mismatch', differenceMinor: diff };
}

/**
 * "Fix automatically": makes the sums agree with the printed total by adding the difference explicitly, never silently.
 * Missing money (diff > 0) becomes an extra line with `otherLabel`; excess (diff < 0) is added to the discount.
 */
export function balanceDraft(draft: Draft, otherLabel: string, makeId: () => string): Draft {
  const rec = reconcileDraft(draft);
  if (rec.state !== 'mismatch') return draft;
  const diff = rec.differenceMinor;
  if (diff > 0) {
    const extra: DraftItem = { id: makeId(), name: otherLabel, quantity: 1, unitMinor: diff, confidence: 1 };
    return { ...draft, items: [...draft.items, extra], updatedAt: Date.now() };
  }
  const t = computeTotals(draft);
  return { ...draft, discount: { mode: 'amount', amountMinor: t.discount - diff, percentBp: 0 }, updatedAt: Date.now() };
}

// ---------- validation ----------
export type DraftIssue = { itemId?: string; field: 'items' | 'name' | 'quantity' | 'price' | 'total' };

export function validateDraft(draft: Draft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (draft.items.length === 0) issues.push({ field: 'items' });
  if (draft.items.length > MAX_ITEMS) issues.push({ field: 'items' });
  for (const it of draft.items) {
    if (it.name.trim() === '') issues.push({ itemId: it.id, field: 'name' });
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QUANTITY) issues.push({ itemId: it.id, field: 'quantity' });
    if (!Number.isInteger(it.unitMinor) || it.unitMinor < 0 || it.unitMinor > MAX_MINOR) issues.push({ itemId: it.id, field: 'price' });
  }
  if (draft.items.length > 0 && computeTotals(draft).total <= 0) issues.push({ field: 'total' });
  return issues;
}

// ---------- from the server ----------
export interface ScanReceiptDto {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  items: { name: string; quantity: number; unitMinor: number; totalMinor: number; confidence: number }[];
  taxMinor: number;
  tipMinor: number;
  discountMinor: number;
  totalMinor: number | null;
  warnings: { code: string; itemIndexes?: number[] }[];
}

export function draftFromScan(r: ScanReceiptDto, fallbackCurrency: string, makeId: () => string, now = Date.now()): Draft {
  const currency = r.currency || fallbackCurrency;
  const items: DraftItem[] = r.items.map((it) => {
    // the app splits whole units; a fractional/zero quantity (e.g. 0.35 kg) becomes one line at the printed line total
    const whole = Number.isInteger(it.quantity) && it.quantity >= 1 && it.quantity <= MAX_QUANTITY;
    return whole
      ? { id: makeId(), name: it.name, quantity: it.quantity, unitMinor: it.unitMinor, confidence: it.confidence }
      : { id: makeId(), name: it.name, quantity: 1, unitMinor: it.totalMinor, confidence: it.confidence };
  });
  const amount = (minor: number): Adjustment => ({ mode: 'amount', amountMinor: Math.abs(minor), percentBp: 0 });
  return {
    source: 'scan',
    merchant: r.merchant ?? '',
    date: r.date,
    currency,
    items,
    tax: amount(r.taxMinor),
    tip: amount(r.tipMinor),
    discount: amount(r.discountMinor),
    receiptTotalMinor: r.totalMinor,
    updatedAt: now,
  };
}

// ---------- to the existing split flow ----------
export interface SplitItemInput {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  kind?: 'tax' | 'tip' | 'discount';
}

/** Lines for participants/items-split. Tax and tip are separate lines, a discount is a negative line. */
export function toSplitItems(draft: Draft, labels: { tax: string; tip: string; discount: string }, makeId: () => string): SplitItemInput[] {
  const c = draft.currency;
  const out: SplitItemInput[] = draft.items.map((it) => ({
    id: it.id,
    name: it.name.trim(),
    unitPrice: minorToMajor(it.unitMinor, c),
    quantity: it.quantity,
    totalPrice: minorToMajor(lineMinor(it), c),
  }));
  const t = computeTotals(draft);
  const add = (minor: number, label: string, kind: SplitItemInput['kind']) => {
    if (minor === 0) return;
    const v = minorToMajor(minor, c);
    out.push({ id: makeId(), name: label, unitPrice: v, quantity: 1, totalPrice: v, kind });
  };
  add(t.tax, labels.tax, 'tax');
  add(t.tip, labels.tip, 'tip');
  add(-t.discount, labels.discount, 'discount');
  return out;
}

// ---------- currency change ----------
/**
 * Switches the receipt currency keeping every amount's MAJOR value (12.50 USD -> 12.50 EUR; 1500 JPY stays 1500).
 * Needed because minor units mean different things for 0- and 2-digit currencies (cents vs whole yen).
 */
export function changeCurrency(draft: Draft, next: string): Draft {
  if (next === draft.currency) return draft;
  const conv = (minor: number) => toMinorUnits(minorToMajor(minor, draft.currency), next);
  const adj = (a: Adjustment): Adjustment => ({ ...a, amountMinor: conv(a.amountMinor) });
  return {
    ...draft,
    currency: next,
    items: draft.items.map((i) => ({ ...i, unitMinor: conv(i.unitMinor) })),
    tax: adj(draft.tax),
    tip: adj(draft.tip),
    discount: adj(draft.discount),
    receiptTotalMinor: draft.receiptTotalMinor == null ? null : conv(draft.receiptTotalMinor),
    updatedAt: Date.now(),
  };
}

// ---------- misc ----------
/** YYYY-MM-DD that is a real calendar date. */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Name of the bill when the receipt has no venue: "2026-10-20 18:05" (local time). */
export function defaultReceiptName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}
