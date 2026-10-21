import React from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { FileText, Mail, ScanLine, Scale, ShieldCheck } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { SUPPORT_EMAIL } from '@/shared/config/app-info';
import { Card, FadeIn, Row, Screen, Section } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

export default function AboutScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '—';
  const sdk = Constants.expoConfig?.sdkVersion ?? '—';

  const feedback = () => {
    const subject = encodeURIComponent(t('settings.about.feedbackSubject', 'Splitter feedback'));
    const body = encodeURIComponent(`\n\n—\nSplitter ${version} · ${Platform.OS} ${Platform.Version}`);
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
  };

  return (
    <Screen keyboard={false}>
      <FadeIn>
        <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
            <ScanLine size={34} color="#FFFFFF" />
          </View>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, fontWeight: '800' }}>{t('app.name', 'Receipt Splitter')}</Text>
          <Text style={{ color: c.textMuted, fontSize: 14 }}>{t('settings.about.version', { version, defaultValue: 'Version {{version}}' })}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13 }}>{`Expo SDK ${sdk} · ${Platform.OS}`}</Text>
        </Card>
      </FadeIn>
      <FadeIn delay={60}>
        <Section>
          <Row icon={<ShieldCheck size={22} color={c.accentText} />} label={t('legal.privacy.title', 'Privacy policy')} onPress={() => router.push({ pathname: '/tabs/legal', params: { doc: 'privacy' } } as never)} />
          <Row icon={<FileText size={22} color={c.accentText} />} label={t('legal.terms.title', 'Terms of use')} onPress={() => router.push({ pathname: '/tabs/legal', params: { doc: 'terms' } } as never)} />
          <Row icon={<Scale size={22} color={c.accentText} />} label={t('legal.licenses.title', 'Open-source licenses')} onPress={() => router.push({ pathname: '/tabs/legal', params: { doc: 'licenses' } } as never)} />
        </Section>
      </FadeIn>
      <FadeIn delay={120}>
        <Section>
          <Row icon={<Mail size={22} color={c.accentText} />} label={t('settings.about.feedback', 'Send feedback')} subtitle={SUPPORT_EMAIL} onPress={feedback} role="link" chevron={false} />
        </Section>
      </FadeIn>
    </Screen>
  );
}
