/** Primary keys are 32-bit signed integers in PostgreSQL: anything else can never exist and must not reach the database. */
export const MAX_DB_ID = 2_147_483_647;

export const isDbId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_DB_ID;

/** True when a string, or any string inside a JSON value, contains a NUL byte (PostgreSQL rejects it with an error). */
export function hasNulChar(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (depth > 8 || value === null || typeof value !== "object") return false;
  for (const v of Object.values(value as Record<string, unknown>)) if (hasNulChar(v, depth + 1)) return true;
  return false;
}
