/**
 * Username rules (server side; the app mirrors them in src/features/profile/lib/validation.ts):
 * 2-32 characters after trimming, letters/digits of any script, and inner space . _ ' ’ -;
 * must start with a letter or digit. No control or invisible characters, no emoji.
 */
export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: "required" | "length" | "chars" };

export function checkUsername(raw: unknown): UsernameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "required" };
  const value = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!value) return { ok: false, reason: "required" };
  const length = [...value].length;
  if (length < 2 || length > 32) return { ok: false, reason: "length" };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u.test(value)) return { ok: false, reason: "chars" };
  return { ok: true, value };
}
