import React, { useCallback, useRef, useState } from 'react';
import { useLeaveGuard } from '@/shared/lib/navigation/use-leave-guard';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { useProfileActions } from '@/features/profile/model/use-profile-actions';
import { validateEmail } from '@/features/profile/lib/validation';
import { Banner, Button, Field, FadeIn, Screen, Title } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

export default function ChangeEmailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const actions = useProfileActions();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useLeaveGuard({ dirty: password !== '' || email.trim() !== (user?.email ?? ''), busy, saved: done });

  const submit = useCallback(async () => {
    if (busy) return;
    const v = validateEmail(email);
    setEmailError(v.ok ? null : t(v.key));
    setPasswordError(password ? null : t('profile.errors.passwordRequired'));
    if (!v.ok || !password) { haptics.error(); return; }
    setBusy(true);
    const r = await actions.changeEmail(email, password);
    setBusy(false);
    if (r.ok) {
      haptics.success();
      setDone(true);
      setPassword('');
      setTimeout(() => router.back(), 900);
      return;
    }
    haptics.error();
    // the password-related errors belong to the password field, the rest to the email field
    if (r.key === 'profile.errors.wrongPassword' || r.key === 'profile.errors.passwordRequired') setPasswordError(t(r.key));
    else setEmailError(t(r.key));
  }, [actions, busy, email, password, router, t]);

  return (
    <Screen>
      <FadeIn style={{ gap: space.lg }}>
        <Title>{t('settings.email.title', 'Change email')}</Title>
        {done && <Banner kind="success">{t('profile.saved', 'Saved')}</Banner>}
        <Field
          label={t('settings.email.new', 'New email')}
          value={email}
          onChangeText={(v) => { setEmail(v); setEmailError(null); }}
          error={emailError}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />
        <Field
          ref={passwordRef}
          label={t('settings.email.password', 'Your password')}
          helper={t('settings.email.passwordHelp', 'We ask for it to make sure it is really you.')}
          value={password}
          onChangeText={(v) => { setPassword(v); setPasswordError(null); }}
          error={passwordError}
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Button title={t('profile.actions.save', 'Save')} onPress={submit} loading={busy} disabled={done} />
      </FadeIn>
    </Screen>
  );
}
