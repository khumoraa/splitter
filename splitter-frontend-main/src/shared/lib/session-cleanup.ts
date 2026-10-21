/**
 * Everything that belongs to the signed-in person (friends, groups, history, the receipt being edited, ...) must be
 * wiped when they sign out or their account is deleted, so the next person on this phone never sees it.
 * Stores register a reset function here; logout runs them all. (A registry avoids import cycles between the stores.)
 */
const resets = new Set<() => void>();

/** Registers a reset; returns an unregister function. */
export function onSessionCleanup(fn: () => void): () => void {
  resets.add(fn);
  return () => resets.delete(fn);
}

/** Runs every registered reset; one failing reset never stops the others. Returns how many failed. */
export function runSessionCleanup(): number {
  let failed = 0;
  for (const fn of [...resets]) {
    try {
      fn();
    } catch {
      failed++;
    }
  }
  return failed;
}
