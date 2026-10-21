/** Limits and input rules for groups and invitations. Pure module (no imports). */
export const MAX_GROUP_NAME = 60;
export const MAX_GROUP_MEMBERS = 50;
export const MAX_PENDING_PER_GROUP = 20;
export const MAX_INVITES_PER_DAY = 30;
export const MAX_ADD_BATCH = 20;

/** Trimmed, inner whitespace collapsed; null if empty or longer than MAX_GROUP_NAME (counted in characters). */
export function normalizeGroupName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  const len = Array.from(name).length;
  return len >= 1 && len <= MAX_GROUP_NAME ? name : null;
}

/** Accepts `uniqueIds: string[]` (up to MAX_ADD_BATCH, deduplicated) or a single `uniqueId`; null if neither is valid. */
export function readUniqueIds(body: any): string[] | null {
  const list: unknown[] = Array.isArray(body?.uniqueIds) ? body.uniqueIds : body?.uniqueId !== undefined ? [body.uniqueId] : [];
  if (list.length === 0 || list.length > MAX_ADD_BATCH) return null;
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string" || !v.trim()) return null;
    const id = v.trim();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
