/**
 * Used when an account is deleted: the history that OTHER users keep (SessionHistoryEntry.payload JSON) must not
 * keep identifying the deleted person, and their short uniqueId (#1234) must not leak to whoever receives that
 * id next. Replaces the id everywhere it appears (as a value) and the name next to it.
 */
export function anonymizePayload<T>(payload: T, oldUid: string, newUid: string, label: string): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const isPerson = obj.uniqueId === oldUid;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (isPerson && (k === "username" || k === "displayName" || k === "name")) out[k] = label;
        else if (isPerson && k === "avatarUrl") out[k] = null;
        else out[k] = walk(v);
      }
      return out;
    }
    if (typeof node === "string" && node === oldUid) return newUid;
    return node;
  };
  return walk(payload) as T;
}

/** Same for a list of uniqueIds (SessionHistoryEntry.participantUniqueIds). */
export function replaceUniqueId(ids: string[], oldUid: string, newUid: string): string[] {
  return Array.from(new Set(ids.map((id) => (id === oldUid ? newUid : id)))).sort();
}
