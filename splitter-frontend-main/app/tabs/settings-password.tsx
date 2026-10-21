import React, { useCallback, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { haptics } from '@/shared/lib/haptics';
import { useProfileActions } from '@/features/profile/model/use-profile-actions';
import { validatePasswordChange } from '@/features/profile/lib/validation';
import { Banner, Button, Field, FadeIn, Screen, Title } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const actions = useProfileActions();
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  /** puts an error key under the field it is about */
  const place = useCallback((key: string) => {
    const field =
      key === 'profile.errors.currentPasswordRequired' || key === 'profile.errors.wrongPassword' ? 'current'
      : key === 'profile.errors.passwordMismatch' ? 'confirm'
      : 'next';
    setErrors({ [field]: t(key) });
  }, [t]);

  const submit = useCallback(async () => {
    if (busy) return;
    const local = validatePasswordChange({ current, next, confirm });
    if (local) { place(local); haptics.error(); return; }
    setErrors({});
    setBusy(true);
    const r = await actions.changePassword(current, next, confirm);
    setBusy(false);
    if (r.ok) {
      haptics.success();
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      setTimeout(() => router.back(), 900);
    } else {
      haptics.error();
      place(r.key);
    }
  }, [actions, busy, confirm, current, next, place, router]);

  return (
    <Screen>
      <FadeIn style={{ gap: space.lg }}>
        <Title>{t('settings.password.title', 'Change password')}</Title>
        {done && <Banner kind="success">{t('settings.password.done', 'Password changed')}</Banner>}
        <Field
          label={t('settings.password.current', 'Current password')}
          value={current}
          onChangeText={(v) => { setCurrent(v); setErrors((e) => ({ ...e, current: undefined })); }}
          error={errors.current}
          password
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="next"
          onSubmitEditing={() => nextRef.current?.focus()}
          blurOnSubmit={false}
        />
        <Field
          ref={nextRef}
          label={t('settings.password.new', 'New password')}
          helper={t('settings.password.rules', 'At least 8 characters with an uppercase letter, a lowercase letter, a digit and a special character.')}
          value={next}
          onChangeText={(v) => { setNext(v); setErrors((e) => ({ ...e, next: undefined })); }}
          error={errors.next}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          blurOnSubmit={false}
        />
        <Field
          ref={confirmRef}
          label={t('settings.password.confirm', 'Repeat new password')}
          value={confirm}
          onChangeText={(v) => { setConfirm(v); setErrors((e) => ({ ...e, confirm: undefined })); }}
          error={errors.confirm}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Button title={t('settings.password.submit', 'Change password')} onPress={submit} loading={busy} disabled={done} />
      </FadeIn>
    </Screen>
  );
}
