/**
 * Veil laid over the system glass/blur so text keeps WCAG AA contrast whatever is behind it. Pure.
 * glass.test.mjs checks text and muted text against the worst cases (pure black and pure white behind the glass).
 */
export const GLASS_VEIL_ALPHA = 0.88;

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Colour seen through a veil of `top` at `alpha` over `bottom` (both #RRGGBB). */
export function composite(top: string, bottom: string, alpha: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(top), p(bottom)];
  return '#' + a.map((v, i) => hex(v * alpha + b[i]! * (1 - alpha))).join('');
}

/** rgba() string of the veil for a palette surface colour. */
export function veil(surfaceHex: string, alpha = GLASS_VEIL_ALPHA): string {
  const n = parseInt(surfaceHex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
