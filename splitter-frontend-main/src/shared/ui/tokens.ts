/**
 * Design tokens for the profile/settings section (docs/profile-redesign.md).
 * Text colours are checked against WCAG AA by tokens.test.mjs, so a palette edit that breaks contrast fails the tests.
 */
export type Scheme = 'light' | 'dark';

export interface Palette {
  /** screen background */
  screen: string;
  /** cards, list groups */
  surface: string;
  /** inputs inside a card */
  field: string;
  text: string;
  textMuted: string;
  border: string;
  /** brand green, decorative only (avatar rings, illustrations): too light for text */
  accent: string;
  /** green for text/icons on screen or surface backgrounds */
  accentText: string;
  /** filled primary button background (the label is `onAccent`) */
  accentFill: string;
  onAccent: string;
  danger: string;
  /** filled destructive button background (the label is `onDanger`) */
  dangerFill: string;
  onDanger: string;
  /** soft tinted backgrounds for banners */
  dangerSurface: string;
  accentSurface: string;
  overlay: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    screen: '#F2F3F5',
    surface: '#FFFFFF',
    field: '#F4F5F6',
    text: '#111413',
    textMuted: '#5B6360',
    border: '#E2E5E4',
    accent: '#2ECC71',
    accentText: '#17803F',
    accentFill: '#17803F',
    onAccent: '#FFFFFF',
    danger: '#C62F34',
    dangerFill: '#C62F34',
    onDanger: '#FFFFFF',
    dangerSurface: '#FDECEC',
    accentSurface: '#E7F7EE',
    overlay: 'rgba(0,0,0,0.45)',
  },
  dark: {
    screen: '#0D0F0E',
    surface: '#1A1D1C',
    field: '#242827',
    text: '#F3F5F4',
    textMuted: '#A3ABA8',
    border: '#2C312F',
    accent: '#2ECC71',
    accentText: '#4ADE80',
    accentFill: '#17803F',
    onAccent: '#FFFFFF',
    danger: '#FF7B80',
    dangerFill: '#D6393F',
    onDanger: '#FFFFFF',
    dangerSurface: '#3A1A1C',
    accentSurface: '#14301F',
    overlay: 'rgba(0,0,0,0.65)',
  },
};

/** WCAG 2.x contrast ratio between two #RRGGBB colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { field: 12, card: 16, button: 14, pill: 999 } as const;
export const MIN_TOUCH = 44;

/** Which scheme to render: an explicit choice wins, "system" follows the phone. */
export type ThemeMode = 'system' | 'light' | 'dark';
export function resolveScheme(mode: ThemeMode, system: string | null | undefined): Scheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}
