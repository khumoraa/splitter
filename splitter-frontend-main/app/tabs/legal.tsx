import React from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/shared/lib/theme/use-colors';
import licenses from '@/shared/config/licenses.json';
import { Card, FadeIn, Screen, Title } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

type Doc = 'privacy' | 'terms' | 'licenses';

/** Privacy policy, terms and open-source licenses. The policy and terms are PLACEHOLDER texts: get them reviewed before publishing. */
export default function LegalScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const kind: Doc = doc === 'terms' || doc === 'licenses' ? doc : 'privacy';

  if (kind === 'licenses') {
    return (
      <Screen keyboard={false}>
        <FadeIn style={{ gap: space.lg }}>
          <Title>{t('legal.licenses.title', 'Open-source licenses')}</Title>
          <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20 }}>{t('legal.licenses.intro', 'Splitter is built with these open-source packages. Thank you to their authors.')}</Text>
          <Card style={{ gap: space.md }}>
            {licenses.map((l) => (
              <View key={l.name} accessible accessibilityLabel={`${l.name} ${l.version}, ${l.license}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                <Text style={{ flex: 1, color: c.text, fontSize: 14 }}>{l.name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 13 }}>{`${l.version} · ${l.license}`}</Text>
              </View>
            ))}
          </Card>
        </FadeIn>
      </Screen>
    );
  }

  const paragraphs = t(`legal.${kind}.body`, '').split('\n\n').filter(Boolean);
  return (
    <Screen keyboard={false}>
      <FadeIn style={{ gap: space.lg }}>
        <Title>{t(`legal.${kind}.title`, kind)}</Title>
        {paragraphs.map((p, i) => (
          <Text key={i} maxFontSizeMultiplier={1.6} style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>{p}</Text>
        ))}
        <Text style={{ color: c.textMuted, fontSize: 13 }}>{t('legal.updated', 'Last updated: October 2026')}</Text>
      </FadeIn>
    </Screen>
  );
}
