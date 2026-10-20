import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppProviders from '../src/application/providers/AppProviders';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';

export default function RootLayout() {
  const { t } = useTranslation();
  return (
    <AppProviders>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="tabs" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: t('auth.signIn', 'Sign In') }} />
        <Stack.Screen name="register" options={{ title: t('auth.createAccount', 'Create Account') }} />
        <Stack.Screen name="scan-invite" options={{ title: t('scanInvite.title', 'Scan invite') }} />
      </Stack>
      <OfflineBanner />
    </AppProviders>
  );
}