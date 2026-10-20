/**
 * Money helpers working in integer minor units (cents).
 * Pure module with no imports: the frontend keeps an identical copy
 * (splitter-frontend/src/shared/lib/utils/money.ts) so both sides split bills the same way.
 */

/** Convert a decimal amount to integer cents without float drift (1.005 -> 101, 0.1*3 -> 30). */
export function toMinor(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError(`Not a finite amount: ${amount}`);
  return Math.round(Number((amount * 100).toPrecision(12)));
}

/** Convert integer cents back to a decimal amount with at most 2 digits. */
export function fromMinor(minor: number): number {
  return Math.round(minor) / 100;
}

/**
 * Split `totalMinor` into `parts` integer shares that always sum to `totalMinor`.
 * The leftover cents (total % parts) go one-by-one to the shares starting at `offset`
 * (wrapping around), so callers can rotate `offset` per item and nobody is always the one
 * who pays the extra cent. Works for negative totals too (discount lines).
 */
export function splitMinor(totalMinor: number, parts: number, offset = 0): number[] {
  if (!Number.isInteger(totalMinor)) throw new RangeError("totalMinor must be an integer");
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be a positive integer");
  const sign = totalMinor < 0 ? -1 : 1;
  const abs = Math.abs(totalMinor);
  const base = Math.floor(abs / parts);
  const rest = abs - base * parts;
  const shares = new Array<number>(parts).fill(base);
  const start = ((Math.trunc(offset) % parts) + parts) % parts;
  for (let i = 0; i < rest; i++) shares[(start + i) % parts]! += 1;
  return shares.map((s) => sign * s);
}

/** Currencies the app shows without a fractional part (kept in sync with how amounts are displayed). */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "UZS", "IDR", "CLP", "ISK", "HUF"]);

export function currencyFractionDigits(currency: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.has((currency || "").toUpperCase()) ? 0 : 2;
}

/** "1,234.50" style; no fractional digits for zero-decimal currencies, always 2 otherwise. */
export function formatAmount(amount: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const n = Number.isFinite(amount) ? amount : 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
