/** Initials and a stable background colour for users without a picture. */
export function initialsOf(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '?';
  const second = words.length > 1 ? Array.from(words[words.length - 1]!)[0] ?? '' : '';
  return (first + second).toLocaleUpperCase();
}

/** Backgrounds for white initials: every colour has >= 4.5:1 contrast with #FFFFFF (checked in avatar-style.test.mjs). */
export const AVATAR_COLORS = ['#B93B0E', '#0B6F66', '#1D4ED8', '#7E22CE', '#BE185D', '#15803D', '#A04A06', '#334155'] as const;

export function avatarColorFor(seed: string | null | undefined): string {
  let h = 0;
  for (const ch of String(seed ?? '')) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Square crop box for an image of the given size (centered), for expo-image-manipulator. */
export function centerSquareCrop(width: number, height: number): { originX: number; originY: number; width: number; height: number } {
  const side = Math.max(1, Math.min(Math.floor(width), Math.floor(height)));
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}
