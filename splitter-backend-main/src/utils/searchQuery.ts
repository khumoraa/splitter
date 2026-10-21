/**
 * Parsing and ranking for the user search. Pure module (no imports).
 * IDs look like "#1234". A query is treated as an ID when it carries a '#', or is exactly four digits (then usernames
 * made of those digits are searched too). Anything else is a username search: exact, then prefix, then substring.
 */
export const MIN_NAME_LEN = 2;
export const MAX_QUERY_LEN = 64;

export type ParsedQuery =
  | { kind: "empty" }
  | { kind: "short" }
  | { kind: "invalid" }
  | { kind: "id"; uniqueId: string; namePart: string }
  | { kind: "name"; text: string; alsoId: string | null };

const clean = (s: string) => s.normalize("NFC").trim().replace(/\s+/gu, " ");

export function parseSearchQuery(raw: unknown): ParsedQuery {
  if (typeof raw !== "string") return { kind: "empty" };
  let q = clean(raw);
  if (q === "") return { kind: "empty" };
  if (Array.from(q).length > MAX_QUERY_LEN) return { kind: "invalid" };
  q = q.replace(/^@+/u, "").trim();
  if (q === "") return { kind: "short" };

  const withHash = /^(.*?)\s*#\s*(\d{4})$/u.exec(q);
  if (withHash) return { kind: "id", uniqueId: `#${withHash[2]}`, namePart: withHash[1]!.trim() };
  if (q.includes("#")) return { kind: "short" }; // an incomplete ID such as "#12": IDs are matched exactly

  if (/^\d{4}$/u.test(q)) return { kind: "name", text: q, alsoId: `#${q}` };
  if (Array.from(q).length < MIN_NAME_LEN) return { kind: "short" };
  return { kind: "name", text: q, alsoId: null };
}

/** 0 exact, 1 prefix, 2 substring, null no match (case-insensitive). */
export function matchRank(username: string, text: string): 0 | 1 | 2 | null {
  const u = username.normalize("NFC").toLowerCase();
  const t = text.normalize("NFC").toLowerCase();
  if (t === "") return null;
  if (u === t) return 0;
  if (u.startsWith(t)) return 1;
  if (u.includes(t)) return 2;
  return null;
}

export interface Candidate { id: number; username: string }

/** Stable order: rank, then lower(username), then id. Candidates that do not match are dropped. */
export function rankCandidates<T extends Candidate>(items: T[], text: string): T[] {
  const ranked: { item: T; rank: number; key: string }[] = [];
  for (const item of items) {
    const rank = matchRank(item.username, text);
    if (rank !== null) ranked.push({ item, rank, key: item.username.normalize("NFC").toLowerCase() });
  }
  ranked.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.item.id - b.item.id);
  return ranked.map((r) => r.item);
}

export function clampPaging(limitRaw: unknown, offsetRaw: unknown): { limit: number; offset: number } {
  const MAX_LIMIT = 20;
  const MAX_WINDOW = 100;
  const l = Math.trunc(Number(limitRaw));
  const o = Math.trunc(Number(offsetRaw));
  const limit = Number.isFinite(l) && l >= 1 ? Math.min(l, MAX_LIMIT) : MAX_LIMIT;
  let offset = Number.isFinite(o) && o >= 0 ? o : 0;
  offset = Math.min(offset, MAX_WINDOW - limit);
  return { limit, offset };
}
