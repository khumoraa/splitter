/** Random id for local list items and for the Idempotency-Key (no crypto dependency needed: uniqueness per user is enough). */
export function makeId(prefix = 'i'): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rnd()}${rnd()}`;
}
