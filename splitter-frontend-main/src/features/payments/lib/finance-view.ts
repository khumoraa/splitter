/** Shaping the summary for the Finances screen. Pure. */
export interface PersonBalance { id: number; outstandingMinor: number; settledMinor: number; count: number; user: { id: number; username: string; uniqueId: string; avatarUrl: string | null } | null }
export interface SideLike { outstandingMinor: number; people: PersonBalance[] }
export interface CurrencyLike { currency: string; owedToMe: SideLike; iOwe: SideLike }

export type Side = 'owedToMe' | 'iOwe';

/** People of one side across currencies, each line in ONE currency (amounts of different currencies are never added). */
export function peopleRows(currencies: CurrencyLike[], side: Side, query: string): { key: string; currency: string; person: PersonBalance }[] {
  const q = query.trim().toLowerCase().replace(/^[@#]/, '');
  const rows: { key: string; currency: string; person: PersonBalance }[] = [];
  for (const c of currencies) {
    for (const p of c[side].people) {
      if (!p.user) continue;
      if (q && !p.user.username.toLowerCase().includes(q) && !p.user.uniqueId.toLowerCase().includes(q)) continue;
      rows.push({ key: `${c.currency}:${p.id}`, currency: c.currency, person: p });
    }
  }
  return rows.sort((a, b) => b.person.outstandingMinor - a.person.outstandingMinor || a.key.localeCompare(b.key));
}

export type Period = 'all' | '30d' | '90d' | 'year';

/** ISO start date for a period filter (null = no limit). */
export function periodFrom(p: Period, now: number): string | null {
  const day = 24 * 60 * 60 * 1000;
  if (p === '30d') return new Date(now - 30 * day).toISOString();
  if (p === '90d') return new Date(now - 90 * day).toISOString();
  if (p === 'year') return new Date(now - 365 * day).toISOString();
  return null;
}

/** 0..1 settled share for a progress bar; an empty total counts as done. */
export const settledRatio = (settled: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, settled / total)) : 1);
