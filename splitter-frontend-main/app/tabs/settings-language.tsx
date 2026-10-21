import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { LANGUAGE_CODES, LANGUAGE_NATIVE_NAMES } from '@/shared/config/languages';
import { Row, Screen, Section, FadeIn } from '@/features/profile/ui/kit';

/** The language applies immediately (I18nProvider listens to the store) and is saved on the phone. */
export default function LanguageScreen() {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  return (
    <Screen keyboard={false}>
      <FadeIn>
        <Section footer={t('settings.language.description', 'Choose the language used across the app.')}>
          {LANGUAGE_CODES.map((code) => (
            <Row
              key={code}
              role="radio"
              label={LANGUAGE_NATIVE_NAMES[code]}
              subtitle={code === language ? t('settings.language.current', 'Current language') : undefined}
              selected={code === language}
              onPress={() => setLanguage(code)}
            />
          ))}
        </Section>
      </FadeIn>
    </Screen>
  );
}
