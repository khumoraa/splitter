import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Coins, Download, Globe, Info, KeyRound, LogOut, Mail, Moon, Smartphone, Sun, Trash2, User as UserIcon } from '@tamagui/lucide-icons';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors } from '@/shared/lib/theme/use-colors';
import { LANGUAGE_NATIVE_NAMES } from '@/shared/config/languages';
import { haptics } from '@/shared/lib/haptics';
import { useProfileActions } from '@/features/profile/model/use-profile-actions';
import { profileApi } from '@/features/profile/api/profile.api';
import { shareAsJsonFile } from '@/features/profile/lib/export-data';
import { profileErrorKey } from '@/features/profile/lib/profile-errors';
import { Banner, FadeIn, Row, Screen, Section } from '@/features/profile/ui/kit';
import type { ThemeMode } from '@/shared/ui/tokens';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const language = useAppStore((s) => s.language);
  const currency = useAppStore((s) => s.defaultCurrency);
  const actions = useProfileActions();
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const confirmSignOut = useCallback(() => {
    Alert.alert(t('settings.signOut.title', 'Sign out?'), t('settings.signOut.message', 'You will need to sign in again to use the app.'), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      {
        text: t('settings.signOut.confirm', 'Sign out'),
        style: 'destructive',
        onPress: async () => {
          await actions.signOut();
          router.replace('/');
        },
      },
    ]);
  }, [actions, router, t]);

  const exportData = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setNotice(null);
    try {
      const data = await profileApi.exportMyData();
      const result = await shareAsJsonFile(data, 'splitter-my-data');
      if (result === 'unavailable') setNotice({ kind: 'error', text: t('settings.data.shareUnavailable', 'Sharing is not available on this device.') });
      else haptics.success();
    } catch (e) {
      haptics.error();
      setNotice({ kind: 'error', text: t(profileErrorKey(e)) });
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  const modes: Array<{ mode: ThemeMode; label: string; icon: React.ReactNode }> = [
    { mode: 'system', label: t('settings.appearance.system', 'System'), icon: <Smartphone size={22} color={c.accentText} /> },
    { mode: 'light', label: t('settings.appearance.light', 'Light'), icon: <Sun size={22} color={c.accentText} /> },
    { mode: 'dark', label: t('settings.appearance.dark', 'Dark'), icon: <Moon size={22} color={c.accentText} /> },
  ];

  return (
    <Screen keyboard={false}>
      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <FadeIn>
        <Section title={t('settings.sections.account', 'Account')}>
          <Row icon={<UserIcon size={22} color={c.accentText} />} label={t('profile.fields.name', 'Name')} value={user?.username} onPress={() => router.push('/tabs/profile-edit')} />
          <Row icon={<Mail size={22} color={c.accentText} />} label={t('profile.fields.email', 'Email')} value={user?.email} onPress={() => router.push('/tabs/settings-email')} />
          <Row icon={<KeyRound size={22} color={c.accentText} />} label={t('settings.account.password', 'Change password')} onPress={() => router.push('/tabs/settings-password')} />
          <Row icon={<LogOut size={22} color={c.danger} />} label={t('settings.account.signOut', 'Sign out')} destructive onPress={confirmSignOut} chevron={false} />
        </Section>
      </FadeIn>

      <FadeIn delay={50}>
        <Section title={t('settings.sections.appearance', 'Appearance')} footer={t('settings.appearance.footer', '"System" follows your phone’s light or dark setting.')}>
          {modes.map((m) => (
            <Row
              key={m.mode}
              icon={m.icon}
              label={m.label}
              role="radio"
              selected={themeMode === m.mode}
              onPress={() => setThemeMode(m.mode)}
              accessibilityLabel={m.label}
            />
          ))}
        </Section>
      </FadeIn>

      <FadeIn delay={100}>
        <Section title={t('settings.sections.language', 'Language')}>
          <Row icon={<Globe size={22} color={c.accentText} />} label={t('settings.language.title', 'Language')} value={LANGUAGE_NATIVE_NAMES[language]} onPress={() => router.push('/tabs/settings-language')} />
        </Section>
      </FadeIn>

      <FadeIn delay={150}>
        <Section title={t('settings.sections.bills', 'Bills')} footer={t('settings.bills.footer', 'Used for a new bill when the receipt does not show a currency.')}>
          <Row icon={<Coins size={22} color={c.accentText} />} label={t('settings.bills.currency', 'Default currency')} value={currency} onPress={() => router.push('/tabs/settings-currency')} />
        </Section>
      </FadeIn>

      <FadeIn delay={200}>
        <Section title={t('settings.sections.data', 'Your data')} footer={t('settings.data.footer', 'A file with your profile, friends, groups and bills that you can save or send.')}>
          <Row
            icon={<Download size={22} color={c.accentText} />}
            label={exporting ? t('settings.data.exporting', 'Preparing...') : t('settings.data.export', 'Export my data')}
            onPress={exportData}
            disabled={exporting}
            chevron={false}
          />
        </Section>
      </FadeIn>

      <FadeIn delay={250}>
        <Section title={t('settings.sections.about', 'About')}>
          <Row icon={<Info size={22} color={c.accentText} />} label={t('settings.about.title', 'About the app')} onPress={() => router.push('/tabs/about')} />
        </Section>
      </FadeIn>

      <FadeIn delay={300}>
        <Section title={t('settings.sections.danger', 'Danger zone')} footer={t('settings.danger.footer', 'Deleting your account cannot be undone.')}>
          <Row icon={<Trash2 size={22} color={c.danger} />} label={t('settings.danger.delete', 'Delete account')} destructive onPress={() => router.push('/tabs/settings-delete')} />
        </Section>
      </FadeIn>
    </Screen>
  );
}
