import React from 'react';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack } from 'tamagui';
import { useTranslation } from 'react-i18next';

/** Thin red strip at the top of the screen while the device has no connection. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const net = useNetInfo();

  // isConnected is null until the first reading; only react to a definite "offline"
  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!offline) return null;

  return (
    <XStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      zIndex={1000}
      bg="#E74C3C"
      pt={insets.top + 4}
      pb={6}
      px="$3"
      ai="center"
      jc="center"
      pointerEvents="none"
    >
      <Text color="white" fontSize={12} fontWeight="600" textAlign="center">
        {t('errors.offline', "You're offline. Some features won't work until the connection is back.")}
      </Text>
    </XStack>
  );
}
