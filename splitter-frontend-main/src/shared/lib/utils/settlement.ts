import { fromMinor, toMinor } from './money.ts';

export type ShareInput = { uniqueId: string; username: string; amountOwed: number };

export type Transfer = {
  from: { uniqueId: string; username: string };
  to: { uniqueId: string; username: string };
  /** decimal amount, always > 0 */
  amount: number;
  amountMinor: number;
};

/**
 * Who pays whom when ONE person (the payer) paid the whole bill.
 * Everyone else owes the payer their share; a negative share (a discount bigger than what
 * the person ordered) flips the direction. The payer never owes themself, and
 * sum(transfers to payer) - sum(transfers from payer) === total - payer's own share, in exact cents.
 */
export function computeSettlements(
  shares: ShareInput[],
  payer: { uniqueId: string; username: string }
): Transfer[] {
  const merged = new Map<string, { username: string; minor: number }>();
  for (const s of shares) {
    if (!s || !s.uniqueId || s.uniqueId === payer.uniqueId) continue;
    const prev = merged.get(s.uniqueId);
    const minor = toMinor(Number(s.amountOwed) || 0);
    merged.set(s.uniqueId, { username: prev?.username ?? s.username, minor: (prev?.minor ?? 0) + minor });
  }
  const transfers: Transfer[] = [];
  for (const [uniqueId, { username, minor }] of merged) {
    if (minor === 0) continue;
    const person = { uniqueId, username };
    transfers.push({
      from: minor > 0 ? person : payer,
      to: minor > 0 ? payer : person,
      amount: fromMinor(Math.abs(minor)),
      amountMinor: Math.abs(minor),
    });
  }
  return transfers;
}
