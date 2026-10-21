import { z } from "zod";
import { LOW_CONFIDENCE, normalizeItem, parseAmount, reconcile, toMinorUnits } from "../utils/scanMath.js";
import type { ScanItem, ScanWarning } from "../utils/scanMath.js";

/** Limits that keep a hallucinated or hostile response from flooding the client. */
export const MAX_SCAN_ITEMS = 120;

const amount = z.union([z.number(), z.string()]).nullish();

/** Strict shape the model must return; anything else is PARSE_FAILED (no silent repair). */
export const modelReceiptSchema = z.object({
  isReceipt: z.boolean(),
  merchant: z.string().max(200).nullish(),
  date: z.string().max(40).nullish(),
  currency: z.string().max(10).nullish(),
  language: z.string().max(20).nullish(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: amount,
        unitPrice: amount,
        lineTotal: amount,
        confidence: z.number().min(0).max(1).nullish(),
      })
    )
    .max(MAX_SCAN_ITEMS),
  tax: amount,
  tip: amount,
  discount: amount,
  total: amount,
});
export type ModelReceipt = z.infer<typeof modelReceiptSchema>;

export type ScanReceipt = {
  merchant: string | null;
  /** ISO date (YYYY-MM-DD) or null */
  date: string | null;
  /** ISO 4217 code or null when the receipt does not say and the client sent no hint */
  currency: string | null;
  language: string | null;
  items: ScanItem[];
  taxMinor: number;
  tipMinor: number;
  discountMinor: number;
  totalMinor: number | null;
  warnings: ScanWarning[];
};

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

function normalizeDate(s: string | null | undefined): string | null {
  const t = clean(s);
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? `${m[1]}-${m[2]}-${m[3]}`
    : null;
}

function normalizeCurrencyCode(c: string | null | undefined): string | null {
  const u = (c ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(u) ? u : null;
}

/** Turns the validated model output into minor-unit amounts and reconciles the totals. */
export function buildReceipt(raw: ModelReceipt, currencyHint?: string | null): ScanReceipt {
  const currency = normalizeCurrencyCode(raw.currency) ?? normalizeCurrencyCode(currencyHint);
  const money = (v: number | string | null | undefined): number | null => {
    const n = parseAmount(v, currency);
    return n == null ? null : toMinorUnits(n, currency);
  };
  const items: ScanItem[] = [];
  const lineMismatchIndexes: number[] = [];
  for (const r of raw.items) {
    const { item, lineMismatch } = normalizeItem(
      {
        name: r.name,
        quantity: r.quantity == null ? null : parseAmount(r.quantity),
        unitPrice: parseAmount(r.unitPrice, currency),
        lineTotal: parseAmount(r.lineTotal, currency),
        confidence: r.confidence ?? null,
      },
      currency
    );
    if (lineMismatch) lineMismatchIndexes.push(items.length);
    items.push(item);
  }
  const taxMinor = Math.abs(money(raw.tax) ?? 0);
  const tipMinor = Math.abs(money(raw.tip) ?? 0);
  const discountMinor = Math.abs(money(raw.discount) ?? 0);
  const totalMinor = money(raw.total);
  const warnings = reconcile({ items, taxMinor, tipMinor, discountMinor, totalMinor, lineMismatchIndexes });
  return {
    merchant: clean(raw.merchant),
    date: normalizeDate(raw.date),
    currency,
    language: clean(raw.language),
    items,
    taxMinor,
    tipMinor,
    discountMinor,
    totalMinor,
    warnings,
  };
}

export { LOW_CONFIDENCE };

/** Extracts the JSON object from a model reply (tolerates a markdown fence, nothing else). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(t);
}

export const RECEIPT_PROMPT = [
  "You read a photo of a restaurant/shop receipt and return ONE JSON object, nothing else.",
  "Set isReceipt=false (and items=[]) if the image is not a purchase receipt or is unreadable.",
  "items: every purchased line with name (as printed), quantity (default 1), unitPrice, lineTotal (price of the whole line) and confidence 0..1 (how sure you are about this line).",
  "Amounts are plain numbers in the receipt currency: no currency symbols, no thousands separators; use '.' as the decimal mark.",
  "Do NOT put tax/VAT, tip, service charge or discounts into items: use tax, tip (service charge goes here) and discount (positive number) instead; use null when absent.",
  "total is the final amount payable printed on the receipt (null if not visible).",
  "currency: ISO 4217 code if you can tell (e.g. USD, JPY, UZS), else null. date: YYYY-MM-DD or null. merchant: venue name or null. language: BCP-47 code of the receipt text.",
  "Never invent lines. Copy numbers exactly as printed.",
].join("\n");

/** Gemini responseSchema (OpenAPI subset). Mirrors modelReceiptSchema. */
const nullableNumber = { type: "NUMBER", nullable: true };
export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isReceipt: { type: "BOOLEAN" },
    merchant: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    language: { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          quantity: nullableNumber,
          unitPrice: nullableNumber,
          lineTotal: nullableNumber,
          confidence: nullableNumber,
        },
        required: ["name"],
      },
    },
    tax: nullableNumber,
    tip: nullableNumber,
    discount: nullableNumber,
    total: nullableNumber,
  },
  required: ["isReceipt", "items"],
};
