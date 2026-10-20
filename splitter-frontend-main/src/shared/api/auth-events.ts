type UnauthorizedListener = () => void | Promise<void>;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Several requests often fail with 401 at once (expired token); notify listeners (logout, navigation) once. */
export const UNAUTHORIZED_COOLDOWN_MS = 1500;
let lastEmitAt = -Infinity;

/** Call after a successful sign-in so a new 401 is never swallowed by the cooldown of the previous session. */
export function resetUnauthorizedCooldown(): void {
  lastEmitAt = -Infinity;
}

export function emitUnauthorized(now: number = Date.now()): void {
  if (now - lastEmitAt < UNAUTHORIZED_COOLDOWN_MS) return;
  lastEmitAt = now;
  unauthorizedListeners.forEach((listener) => {
    try {
      const result = listener();
      if (result instanceof Promise) {
        result.catch((error) => console.error('Unauthorized listener async error:', error));
      }
    } catch (error) {
      console.error('Unauthorized listener error:', error);
    }
  });
}
