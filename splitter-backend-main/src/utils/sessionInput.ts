/**
 * Validation of bill input for manual creation and finalize (no AI involved, no quota).
 * Pure module (no imports). Returns the first problem found, or null.
 */
export const MAX_ITEMS = 200;
export const MAX_PARTICIPANTS = 50;
export const MAX_NAME_LEN = 200;
export const MAX_AMOUNT = 1_000_000_000;

export type InputProblem = { code: "INVALID_ITEMS" | "INVALID_PARTICIPANTS"; field: string; index?: number };

export function validateBillInput(items: unknown, participants: unknown): InputProblem | null {
  if (!Array.isArray(participants) || participants.length === 0 || participants.length > MAX_PARTICIPANTS) {
    return { code: "INVALID_PARTICIPANTS", field: "participants" };
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return { code: "INVALID_ITEMS", field: "items" };
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Record<string, unknown> | null;
    if (!it || typeof it !== "object") return { code: "INVALID_ITEMS", field: "item", index: i };
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (name.length === 0 || name.length > MAX_NAME_LEN) return { code: "INVALID_ITEMS", field: "name", index: i };
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return { code: "INVALID_ITEMS", field: "quantity", index: i };
    const price = Number(it.price ?? it.unitPrice);
    if (!Number.isFinite(price) || Math.abs(price) > MAX_AMOUNT) return { code: "INVALID_ITEMS", field: "price", index: i };
    // only discount lines may be negative
    if (price < 0 && it.kind !== "discount") return { code: "INVALID_ITEMS", field: "price", index: i };
  }
  return null;
}

/** Optional numeric field of POST /sessions: absent -> 0, otherwise a finite number >= 0. */
export function parseMoneyField(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT ? n : null;
}
