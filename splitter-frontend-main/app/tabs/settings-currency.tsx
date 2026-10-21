import React from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors } from '@/shared/lib/theme/use-colors';
import { CURRENCIES } from '@/shared/config/currencies';
import { Row, Screen, Section, FadeIn } from '@/features/profile/ui/kit';

export default function CurrencyScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const current = useAppStore((s) => s.defaultCurrency);
  const setDefaultCurrency = useAppStore((s) => s.setDefaultCurrency);
  return (
    <Screen keyboard={false}>
      <FadeIn>
        <Section footer={t('settings.bills.footer', 'Used for a new bill when the receipt does not show a currency.')}>
          {CURRENCIES.map((cur) => (
            <Row
              key={cur.code}
              role="radio"
              label={`${cur.code} · ${t(`currencies.${cur.code}`, cur.code)}`}
              selected={cur.code === current}
              right={<Text style={{ color: c.textMuted, fontSize: 15 }}>{cur.symbol}</Text>}
              onPress={() => setDefaultCurrency(cur.code)}
            />
          ))}
        </Section>
      </FadeIn>
    </Screen>
  );
}
