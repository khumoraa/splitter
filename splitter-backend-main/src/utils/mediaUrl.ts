/**
 * Avatar URLs for files kept on the server's own disk are stored as a RELATIVE path ("/media/avatars/<uuid>.jpg") and made
 * absolute per request. The phone reaches the server by LAN IP, which changes with the network; a stored absolute URL would
 * break the moment the IP changes. (Files in R2 keep their absolute CDN URL.) Pure module, unit-tested.
 */
export const LOCAL_AVATAR_PREFIX = "/media/avatars/";
const LOCAL_AVATAR_RE = /^\/media\/avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** true for "/media/avatars/<uuid>.<ext>" exactly (no traversal, no extra segments). */
export function isLocalAvatarPath(p: unknown): p is string {
  return typeof p === "string" && LOCAL_AVATAR_RE.test(p);
}

/**
 * Base URL (no trailing slash) to put in front of relative media paths.
 * PUBLIC_BASE_URL wins; otherwise the request's host, but only if it looks like a LAN/local host, so a forged Host header
 * cannot make us hand out links to somebody else's server.
 */
export function resolvePublicBaseUrl(envBase: string | undefined, protocol: string, host: string | undefined): string | null {
  const fromEnv = (envBase ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  if (!host) return null;
  const ok = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+\.local)(:\d{1,5})?$/i.test(host);
  if (!ok) return null;
  return `${protocol === "https" ? "https" : "http"}://${host}`;
}

/** Deep copy of a JSON-like body where every `avatarUrl` that is a relative local path becomes absolute. */
export function rewriteMediaUrls<T>(body: T, base: string | null): T {
  if (!base) return body;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object" && Object.getPrototypeOf(node) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = k === "avatarUrl" && isLocalAvatarPath(v) ? `${base}${v}` : walk(v);
      }
      return out;
    }
    return node; // Date, Prisma Decimal, null, primitives: untouched
  };
  return walk(body) as T;
}

/**
 * Normalises a client-supplied avatar URL to what we store: our own relative path if it points at our media folder,
 * otherwise null (we never store arbitrary third-party URLs).
 */
export function toStoredLocalPath(input: string): string | null {
  if (isLocalAvatarPath(input)) return input;
  try {
    const u = new URL(input);
    return isLocalAvatarPath(u.pathname) ? u.pathname : null;
  } catch {
    return null;
  }
}
