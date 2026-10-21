/** Currencies offered as the default for new bills. `digits` = how many decimals the currency normally shows. */
export interface CurrencyInfo {
  code: string;
  symbol: string;
  digits: 0 | 2;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'UZS', symbol: "so'm", digits: 0 },
  { code: 'USD', symbol: '$', digits: 2 },
  { code: 'EUR', symbol: '€', digits: 2 },
  { code: 'JPY', symbol: '¥', digits: 0 },
  { code: 'RUB', symbol: '₽', digits: 2 },
  { code: 'KZT', symbol: '₸', digits: 2 },
  { code: 'KRW', symbol: '₩', digits: 0 },
  { code: 'GBP', symbol: '£', digits: 2 },
  { code: 'CNY', symbol: '¥', digits: 2 },
  { code: 'TRY', symbol: '₺', digits: 2 },
  { code: 'AED', symbol: 'د.إ', digits: 2 },
  { code: 'INR', symbol: '₹', digits: 2 },
] as const;

export const FALLBACK_CURRENCY = 'UZS';

export function normalizeCurrency(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return CURRENCIES.some((x) => x.code === c) ? c : FALLBACK_CURRENCY;
}
