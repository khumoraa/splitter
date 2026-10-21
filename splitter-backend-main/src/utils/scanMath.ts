/**
 * Number normalisation and total reconciliation for scanned receipts. Pure module (no imports).
 * All results are integer MINOR units of the receipt currency (cents; whole units for zero-decimal currencies).
 * The server never "fixes" a receipt silently: when the sums disagree it reports the difference as a warning.
 */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "UZS", "IDR", "CLP", "ISK", "HUF"]);

export function fractionDigits(currency: string | null | undefined): 0 | 2 {
  return ZERO_DECIMAL.has((currency || "").toUpperCase()) ? 0 : 2;
}

/**
 * Parses an amount as printed on a receipt: "1 234,50", "1.234,50", "1,234.50", "12 500", "$12.99", "UZS 45 000".
 * Returns a decimal number or null when nothing numeric is found. A lone "," or "." followed by exactly three digits
 * is a thousands separator (1,234 -> 1234); otherwise it is the decimal mark. Zero-decimal currencies never have one.
 */
export function parseAmount(input: unknown, currency?: string | null): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.replace(/[\s  ']/g, "");
  const negative = /^\(.*\)$/.test(s) || /^[-−–]/.test(s) || /[-−–]$/.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  if (!/[0-9]/.test(s)) return null;
  const zeroDecimal = currency ? fractionDigits(currency) === 0 : false;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart: string;
  let fracPart = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    intPart = s.slice(0, dec);
    fracPart = s.slice(dec + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sepChar = lastDot >= 0 ? "." : ",";
    const count = s.split(sepChar).length - 1;
    const idx = s.lastIndexOf(sepChar);
    const after = s.slice(idx + 1);
    const before = s.slice(0, idx);
    const looksThousands = count > 1 || zeroDecimal || (after.length === 3 && before.replace(/[.,]/g, "").length >= 1 && before !== "0");
    if (looksThousands) {
      intPart = s;
    } else {
      intPart = before;
      fracPart = after;
    }
  } else {
    intPart = s;
  }
  intPart = intPart.replace(/[.,]/g, "");
  fracPart = fracPart.replace(/[.,]/g, "");
  const n = Number(`${intPart || "0"}${fracPart ? "." + fracPart : ""}`);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Decimal amount -> integer minor units for `currency` (no float drift: 1.005 -> 101 for 2 digits). */
export function toMinorUnits(amount: number, currency: string | null | undefined): number {
  if (!Number.isFinite(amount)) throw new RangeError(`Not a finite amount: ${amount}`);
  const digits = fractionDigits(currency);
  const factor = digits === 0 ? 1 : 100;
  return Math.round(Number((amount * factor).toPrecision(12)));
}

export type RawItem = {
  name: string;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  confidence?: number | null;
};

export type ScanItem = {
  name: string;
  quantity: number;
  unitMinor: number;
  totalMinor: number;
  /** 0..1; < 0.6 should be highlighted by the UI */
  confidence: number;
};

export type ScanWarning =
  | { code: "TOTAL_MISMATCH"; expectedMinor: number; computedMinor: number; differenceMinor: number }
  | { code: "LINE_MISMATCH"; itemIndexes: number[] }
  | { code: "NO_TOTAL" }
  | { code: "NO_ITEMS" };

export const LOW_CONFIDENCE = 0.6;

/** Fills quantity/unit/line total consistently. Never overrides a printed line total. */
export function normalizeItem(raw: RawItem, currency: string | null | undefined): { item: ScanItem; lineMismatch: boolean } {
  const qtyRaw = raw.quantity ?? 1;
  const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw * 1000) / 1000 : 1;
  const unit = raw.unitPrice != null && Number.isFinite(raw.unitPrice) ? toMinorUnits(raw.unitPrice, currency) : null;
  const line = raw.lineTotal != null && Number.isFinite(raw.lineTotal) ? toMinorUnits(raw.lineTotal, currency) : null;
  let unitMinor: number;
  let totalMinor: number;
  let lineMismatch = false;
  if (line != null) {
    totalMinor = line;
    unitMinor = unit ?? Math.round(line / quantity);
    if (unit != null && Math.round(unit * quantity) !== line) lineMismatch = true;
  } else if (unit != null) {
    unitMinor = unit;
    totalMinor = Math.round(unit * quantity);
  } else {
    unitMinor = 0;
    totalMinor = 0;
    lineMismatch = true;
  }
  const conf = raw.confidence != null && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0.8;
  return {
    item: { name: raw.name.trim(), quantity, unitMinor, totalMinor, confidence: lineMismatch ? Math.min(conf, 0.5) : conf },
    lineMismatch,
  };
}

/** items + tax + tip - discount vs the printed receipt total. Returns warnings only; nothing is adjusted. */
export function reconcile(args: {
  items: ScanItem[];
  taxMinor: number;
  tipMinor: number;
  discountMinor: number;
  totalMinor: number | null;
  lineMismatchIndexes?: number[];
}): ScanWarning[] {
  const warnings: ScanWarning[] = [];
  if (args.items.length === 0) warnings.push({ code: "NO_ITEMS" });
  if (args.lineMismatchIndexes && args.lineMismatchIndexes.length > 0) {
    warnings.push({ code: "LINE_MISMATCH", itemIndexes: args.lineMismatchIndexes });
  }
  if (args.totalMinor == null) {
    warnings.push({ code: "NO_TOTAL" });
    return warnings;
  }
  const computed = args.items.reduce((s, i) => s + i.totalMinor, 0) + args.taxMinor + args.tipMinor - args.discountMinor;
  if (computed !== args.totalMinor) {
    warnings.push({
      code: "TOTAL_MISMATCH",
      expectedMinor: args.totalMinor,
      computedMinor: computed,
      differenceMinor: args.totalMinor - computed,
    });
  }
  return warnings;
}
