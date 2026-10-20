// app/tabs/settings.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { YStack, Text, Separator, XStack } from 'tamagui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/Button';
import { ScreenContainer } from '@/shared/ui/ScreenContainer';
import Input from '@/shared/ui/Input';
import PasswordInput from '@/shared/ui/PasswordInput';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { changePassword, updateUsername } from '@/features/auth/api';
import { LANGUAGE_OPTIONS, type LanguageCode } from '@/shared/config/languages';

export default function SettingsScreen() {
  const { user, setUser, language, setLanguage } = useAppStore();
  const { t } = useTranslation();
  const isLoggedIn = !!user;

  const [usernameValue, setUsernameValue] = useState(user?.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    setUsernameValue(user?.username ?? '');
  }, [user?.username]);

  const usernameDirty = useMemo(() => {
    const trimmed = usernameValue.trim();
    return trimmed.length > 0 && trimmed !== (user?.username ?? '').trim();
  }, [usernameValue, user?.username]);

  const validateUsername = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return t('settings.username.errorEmpty', 'Username cannot be empty');
    if (trimmed.length < 2) return t('settings.username.errorShort', 'Username must be at least 2 characters');
    return null;
  };

  const validatePasswordForm = () => {
    if (!currentPassword.trim()) return t('settings.password.errorCurrent', 'Enter your current password');
    if (newPassword.length < 8) return t('settings.password.errorLength', 'New password must be at least 8 characters');
    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);
    const hasSymbol = /[^A-Za-z0-9\s]/.test(newPassword);
    if (!hasUppercase || !hasLowercase || !hasNumber || !hasSymbol) {
      return t('settings.password.errorStrength', 'Password must include uppercase, lowercase, number, and special character');
    }
    if (newPassword !== confirmPassword) return t('settings.password.errorMismatch', 'Passwords do not match');
    if (newPassword === currentPassword) return t('settings.password.errorSame', 'Choose a different password');
    return null;
  };

  const handleLanguageChange = (code: LanguageCode) => {
    if (code === language) return;
    setLanguage(code);
  };

  const handleSaveUsername = async () => {
    if (!isLoggedIn) {
      Alert.alert(t('settings.unavailable', 'Unavailable'), t('settings.username.signInRequired', 'Sign in to update your username.'));
      return;
    }
    const error = validateUsername(usernameValue);
    if (error) {
      setUsernameError(error);
      return;
    }
    setUsernameError(null);

    const trimmed = usernameValue.trim();

    try {
      setIsUpdatingUsername(true);
      const updatedUser = await updateUsername({ username: trimmed });
      setUser(updatedUser);
      Alert.alert(t('common.success', 'Success'), t('settings.username.updated', 'Username updated.'));
    } catch (error) {
      console.error('Username update failed:', error);
      const message = error instanceof Error ? error.message : t('settings.username.updateFailed', 'Could not update the username.');
      Alert.alert(t('common.error', 'Error'), message);
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  const handleChangePassword = async () => {
    if (!isLoggedIn) {
      Alert.alert(t('settings.unavailable', 'Unavailable'), t('settings.password.signInRequired', 'Sign in to change your password.'));
      return;
    }

    const error = validatePasswordForm();
    if (error) {
      setPasswordError(error);
      return;
    }
    setPasswordError(null);

    try {
      setIsChangingPassword(true);
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert(t('settings.password.updatedTitle', 'Password updated'), t('settings.password.updatedMessage', 'Your password has been changed.'));
    } catch (error) {
      console.error('Password change failed:', error);
      const message = error instanceof Error ? error.message : t('settings.password.changeFailed', 'Could not change the password.');
      Alert.alert(t('common.error', 'Error'), message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  useEffect(() => {
    if (usernameError && usernameValue.trim().length >= 2) {
      setUsernameError(null);
    }
  }, [usernameError, usernameValue]);

  useEffect(() => {
    if (passwordError) {
      const err = validatePasswordForm();
      if (!err) setPasswordError(null);
    }
  }, [currentPassword, newPassword, confirmPassword, passwordError]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.select({ ios: 0, android: 0 }) ?? 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenContainer>
            <YStack space="$5">
              {/* Header */}
              <YStack space="$3" mt="$4">
                <Text fontSize={20} fontWeight="700">
                  {t('settings.account.title', 'Account settings')}
                </Text>
                <Text color="$gray10">
                  {t('settings.account.description', 'Update your username and password using the forms below.')}
                </Text>
              </YStack>

              {/* LANGUAGE */}
              <YStack space="$3">
                <Text fontSize={16} fontWeight="600">
                  {t('settings.language.title', 'Language')}
                </Text>
                <Text fontSize={14} color="$gray10">
                  {t('settings.language.description', 'Choose the language used across the app.')}
                </Text>

                <XStack
                  space="$2"
                  backgroundColor="$gray3"
                  borderRadius="$8"
                  padding="$1"
                  flexWrap="wrap"
                >
                  {LANGUAGE_OPTIONS.map((option) => {
                    const isActive = option.code === language;
                    const label = t(
                      `settings.language.options.${option.code}`,
                      option.shortLabel
                    );
                    return (
                      <Button
                        key={option.code}
                        title={label}
                        variant={isActive ? 'primary' : 'outline'}
                        size="small"
                        onPress={() => handleLanguageChange(option.code)}
                      />
                    );
                  })}
                </XStack>
              </YStack>

              <Separator />

              {/* USERNAME */}
              <YStack space="$3">
                <Text fontSize={16} fontWeight="600">{t('settings.username.title', 'Username')}</Text>
                <Input
                  value={usernameValue}
                  onChangeText={setUsernameValue}
                  placeholder={t('settings.username.placeholder', 'Enter a new username')}
                  textInputProps={{ autoCapitalize: 'none', autoCorrect: false }}
                  error={usernameError || undefined}
                />
                <XStack space="$2">
                  <Button
                    title={isUpdatingUsername ? t('settings.username.saving', 'Saving...') : t('settings.username.save', 'Save username')}
                    variant="primary"
                    size="medium"
                    disabled={!usernameDirty || isUpdatingUsername}
                    onPress={handleSaveUsername}
                  />
                  <Button
                    title={t('settings.username.reset', 'Reset')}
                    variant="outline"
                    size="medium"
                    disabled={!usernameDirty}
                    onPress={() => setUsernameValue(user?.username ?? '')}
                  />
                </XStack>
              </YStack>

              <Separator />

              {/* PASSWORD */}
              <YStack space="$3">
                <Text fontSize={16} fontWeight="600">{t('settings.password.title', 'Password')}</Text>
                <PasswordInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder={t('settings.password.current', 'Current password')}
                  textInputProps={{ returnKeyType: 'next' }}
                />
                <PasswordInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder={t('settings.password.new', 'New password')}
                  textInputProps={{ returnKeyType: 'next' }}
                />
                <Text fontSize={12} color="$gray10">
                  {t('settings.password.hint', 'Password must be at least 8 characters and include uppercase, lowercase, number, and special symbol.')}
                </Text>
                <PasswordInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder={t('settings.password.confirm', 'Confirm new password')}
                  error={passwordError || undefined}
                  textInputProps={{ returnKeyType: 'done' }}
                />
                <Button
                  title={isChangingPassword ? t('settings.password.changing', 'Updating...') : t('settings.password.change', 'Change password')}
                  variant="primary"
                  size="medium"
                  disabled={isChangingPassword}
                  onPress={handleChangePassword}
                />
              </YStack>
            </YStack>
          </ScreenContainer>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
