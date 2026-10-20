type UnauthorizedListener = () => void | Promise<void>;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function emitUnauthorized(): void {
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
