// app/tabs/_layout.tsx
//
// Every signed-in screen lives in ONE native stack. (It used to be a Tabs navigator with a hidden tab bar, and tabs
// have no back gesture at all: that is why swiping from the left edge did nothing anywhere.) The native stack gives the
// system swipe-back, standard push transitions, native headers with large titles and form sheets.

import React, { useCallback, useEffect } from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { Text } from 'tamagui';
import { Bell } from '@tamagui/lucide-icons';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { useFriendsStore } from '@/features/friends/model/friends.store';

function DotBadge({ value }: { value?: number }) {
  const c = useColors();
  if (!value || value <= 0) return null;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentFill }}
    >
      <Text color={c.onAccent} fontSize={10} fontWeight="700" allowFontScaling={false}>{value > 99 ? '99+' : value}</Text>
    </View>
  );
}

/** Right side of every header: friend requests bell (with count) and the profile avatar. */
function HeaderActions() {
  const router = useRouter();
  const { t } = useTranslation();
  const c = useColors();
  const user = useAppStore((s) => s.user);
  const fetchAll = useFriendsStore((s) => s.fetchAll);
  const requestsCount = useFriendsStore((s) => s.requestsRaw?.incoming?.length ?? 0);

  useFocusEffect(useCallback(() => { void fetchAll(); }, [fetchAll]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void fetchAll(); });
    return () => sub.remove();
  }, [fetchAll]);

  const displayName = user?.username || t('profile.labels.guest', 'Guest');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable
        onPress={() => router.push('/tabs/friends/requests' as never)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={requestsCount > 0 ? t('social.bell.withCount', { count: requestsCount, defaultValue: 'Friend requests, {{count}} new' }) : t('social.bell.none', 'Friend requests')}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Bell size={22} color={c.textMuted} />
        <DotBadge value={requestsCount} />
      </Pressable>
      <Pressable
        onPress={() => router.push('/tabs/profile' as never)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={t('profile.title', 'Profile')}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <ProfileAvatar uri={user?.avatarUrl} name={displayName} seed={user?.uniqueId} size={32} />
      </Pressable>
    </View>
  );
}

export default function AppStackLayout() {
  const { t } = useTranslation();
  const c = useColors();
  const scheme = useScheme();
  const user = useAppStore((s) => s.user);
  const greetingName = user?.username || t('home.header.friendFallback', 'friend');

  /** list-like top-level screens get the large iOS title */
  const large = { headerLargeTitle: true, headerLargeTitleShadowVisible: false } as const;
  /** screens whose content has its own horizontal gestures (swipe-to-delete rows, chips): back only from the edge */
  const edgeOnly = { fullScreenGestureEnabled: false } as const;

  return (
    <Stack
      screenOptions={{
        headerRight: () => <HeaderActions />,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: c.accentText,
        headerStyle: { backgroundColor: c.screen },
        headerLargeStyle: { backgroundColor: c.screen },
        headerTitleStyle: { color: c.text },
        headerLargeTitleStyle: { color: c.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.screen },
        // iOS: swipe back from anywhere on the screen, not only the very edge
        fullScreenGestureEnabled: Platform.OS === 'ios',
        gestureEnabled: true,
        statusBarStyle: scheme === 'dark' ? 'light' : 'dark',
      }}
    >
      <Stack.Screen name="index" options={{ title: t('home.header.greeting', { name: greetingName }) }} />

      <Stack.Screen name="profile" options={{ title: t('profile.title', 'Profile'), headerRight: undefined }} />
      <Stack.Screen name="profile-edit" options={{ title: t('profile.actions.edit', 'Edit profile'), headerRight: undefined }} />
      <Stack.Screen name="profile-qr" options={{ title: t('profile.qr.title', 'My QR code'), headerRight: undefined }} />
      <Stack.Screen name="settings" options={{ title: t('navigation.tabs.settings', 'Settings'), headerRight: undefined }} />
      <Stack.Screen name="settings-email" options={{ title: t('settings.email.title', 'Change email'), headerRight: undefined }} />
      <Stack.Screen name="settings-password" options={{ title: t('settings.password.title', 'Change password'), headerRight: undefined }} />
      <Stack.Screen name="settings-language" options={{ title: t('settings.language.title', 'Language'), headerRight: undefined }} />
      <Stack.Screen name="settings-currency" options={{ title: t('settings.bills.currency', 'Default currency'), headerRight: undefined }} />
      <Stack.Screen name="settings-delete" options={{ title: t('settings.delete.title', 'Delete account'), headerRight: undefined }} />
      <Stack.Screen name="about" options={{ title: t('settings.about.title', 'About the app'), headerRight: undefined }} />
      <Stack.Screen name="legal" options={{ title: t('settings.about.title', 'About the app'), headerRight: undefined }} />

      <Stack.Screen name="friends/index" options={{ title: t('friends.title', 'Friends'), ...large, ...edgeOnly }} />
      <Stack.Screen name="friends/search" options={{ title: t('friends.title', 'Friends'), ...edgeOnly }} />
      <Stack.Screen name="friends/requests" options={{ title: t('friends.title', 'Friends'), ...edgeOnly }} />
      <Stack.Screen name="friends/invite" options={{ title: t('navigation.friendQr', 'My Friend QR') }} />

      <Stack.Screen name="groups/index" options={{ title: t('navigation.groups.title', 'Groups'), ...large }} />
      <Stack.Screen name="groups/create" options={{ title: t('navigation.groups.create', 'New group') }} />
      <Stack.Screen name="groups/[groupId]" options={{ title: t('navigation.groups.details', 'Group') }} />
      <Stack.Screen name="groups/invite-people" options={{ title: t('social.group.invitePeople', 'Invite people') }} />
      <Stack.Screen name="groups/invite" options={{ title: t('navigation.groupQr', 'Group QR') }} />
      <Stack.Screen name="scan-invite" options={{ title: t('navigation.scanInvite', 'Scan Invite') }} />

      <Stack.Screen name="new-receipt" options={{ title: t('navigation.newReceipt', 'New receipt') }} />
      <Stack.Screen name="scan-camera" options={{ headerShown: false }} />
      <Stack.Screen name="scan-preview" options={{ headerShown: false }} />
      {/* an upload is running: no swipe away (the screen also asks before leaving) */}
      <Stack.Screen name="scan-processing" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="receipt-review" options={{ title: t('navigation.receiptReview', 'Check receipt'), ...edgeOnly }} />
      <Stack.Screen name="receipt-manual" options={{ title: t('navigation.manualEntry', 'Enter manually'), ...edgeOnly }} />
      <Stack.Screen name="sessions/participants" options={{ title: t('navigation.participants', 'Participants'), ...edgeOnly }} />
      <Stack.Screen name="sessions/items-split" options={{ title: t('navigation.itemsSplit', 'Items Split'), ...edgeOnly }} />
      <Stack.Screen name="sessions/finish" options={{ title: t('navigation.finish', 'Finish') }} />
      <Stack.Screen name="sessions/history/index" options={{ title: t('navigation.history', 'Recent bills'), ...large }} />
      <Stack.Screen name="sessions/history/[historyId]" options={{ title: t('navigation.historyDetails', 'Bill details') }} />

      <Stack.Screen name="finances/index" options={{ title: t('finance.title', 'Finances'), ...large }} />
      <Stack.Screen name="finances/person" options={{ title: t('finance.person.title', 'Balance') }} />
      {/* forms open as native iOS sheets: swipe down to close, the parent stays visible behind */}
      <Stack.Screen
        name="payment-sheet"
        options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [0.7, 1], sheetGrabberVisible: true, sheetCornerRadius: 24 }}
      />
    </Stack>
  );
}
