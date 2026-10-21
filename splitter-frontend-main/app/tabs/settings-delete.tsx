import React, { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/shared/lib/theme/use-colors';
import { haptics } from '@/shared/lib/haptics';
import { useProfileActions } from '@/features/profile/model/use-profile-actions';
import { Banner, Button, Card, Field, FadeIn, Screen, Title } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

/** Danger zone. Two confirmations: the password in the form, then a final dialog. */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const actions = useProfileActions();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reallyDelete = useCallback(async () => {
    setBusy(true);
    const r = await actions.deleteAccount(password);
    setBusy(false);
    if (r.ok) {
      haptics.success();
      router.replace('/'); // the token is already gone, Welcome is shown
    } else {
      haptics.error();
      setError(t(r.key));
    }
  }, [actions, password, router, t]);

  const submit = useCallback(() => {
    if (busy) return;
    if (!password) { setError(t('profile.errors.passwordRequired')); haptics.error(); return; }
    setError(null);
    Alert.alert(
      t('settings.delete.confirmTitle', 'Delete your account?'),
      t('settings.delete.confirmMessage', 'This cannot be undone. Your profile will be deleted for good.'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('settings.delete.confirm', 'Delete forever'), style: 'destructive', onPress: () => void reallyDelete() },
      ]
    );
  }, [busy, password, reallyDelete, t]);

  const bullets = [
    t('settings.delete.b1', 'Your profile, photo and sign-in are deleted.'),
    t('settings.delete.b2', 'Your friendships are removed.'),
    t('settings.delete.b3', 'Groups you own go to another member; if you are alone in a group, it is deleted.'),
    t('settings.delete.b4', 'Bills you shared with other people stay for them, but your name is replaced with “Deleted user”.'),
    t('settings.delete.b5', 'Bills that only you were in are deleted.'),
  ];

  return (
    <Screen>
      <FadeIn style={{ gap: space.lg }}>
        <Title>{t('settings.delete.title', 'Delete account')}</Title>
        <Banner kind="error">{t('settings.delete.warning', 'This is permanent. Read what will happen:')}</Banner>
        <Card style={{ gap: space.sm }}>
          {bullets.map((b) => (
            <View key={b} style={{ flexDirection: 'row', gap: space.sm }}>
              <Text style={{ color: c.danger, fontSize: 16 }}>•</Text>
              <Text maxFontSizeMultiplier={1.5} style={{ flex: 1, color: c.text, fontSize: 15, lineHeight: 21 }}>{b}</Text>
            </View>
          ))}
        </Card>
        <Field
          label={t('settings.delete.password', 'Enter your password to confirm')}
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          error={error}
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Button variant="danger" title={t('settings.delete.submit', 'Delete my account')} onPress={submit} loading={busy} />
        <Button variant="secondary" title={t('common.cancel', 'Cancel')} onPress={() => router.back()} disabled={busy} />
      </FadeIn>
    </Screen>
  );
}
