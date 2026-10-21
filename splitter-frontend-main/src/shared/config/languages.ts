export const LANGUAGE_CODES = ['en', 'ja', 'uz'] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export interface LanguageOption {
  code: LanguageCode;
  shortLabel: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', shortLabel: 'EN' },
  { code: 'ja', shortLabel: 'JA' },
  { code: 'uz', shortLabel: 'UZ' },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** 'ja', 'ja-JP', 'JA_jp' -> 'ja'; anything unsupported or empty -> DEFAULT_LANGUAGE. */
export function resolveLanguage(code?: string | null): LanguageCode {
  const base = String(code ?? '').toLowerCase().split(/[-_]/)[0] as LanguageCode;
  return (LANGUAGE_CODES as readonly string[]).includes(base) ? base : DEFAULT_LANGUAGE;
}
