// app/tabs/_layout.tsx

import React, { useCallback, useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Pressable , AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { YStack, XStack, Text, View } from 'tamagui';
import { Home, Settings, Bell, ChevronLeft } from '@tamagui/lucide-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router/react-navigation';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { useFriendsStore } from '@/features/friends/model/friends.store';

// --- Reusable Badge Component ---
function DotBadge({ value }: { value?: number }) {
  if (!value || value <= 0) return null;
  return (
    <View
      position="absolute"
      top={-4} right={-4}
      w={20} h={20}
      br={999}
      ai="center" jc="center"
      backgroundColor="#2ECC71"
    >
      <Text color="white" fontSize={10} fontWeight="700">
        {value}
      </Text>
    </View>
  );
}

/** Screens of the profile/settings section: the header shows "< Back" instead of "< Main menu". */
const SUB_SCREENS = new Set([
  'settings', 'profile-edit', 'profile-qr', 'settings-email', 'settings-password',
  'settings-language', 'settings-currency', 'settings-delete', 'about', 'legal',
  'new-receipt', 'receipt-review', 'receipt-manual',
]);

// --- Global Header for all Tabs ---
function GlobalTabsHeader(props: any) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAppStore();
  const fetchAll = useFriendsStore((s) => s.fetchAll);
  const { t } = useTranslation();
  const routeName = props?.route?.name ?? '';
  const showHomeShortcut =
    routeName === 'profile' ||
    routeName.startsWith('friends') ||
    routeName.startsWith('groups') ||
    routeName.startsWith('sessions');
  const onBackToHome = () => router.replace({ pathname: '/tabs' });
  const isSub = SUB_SCREENS.has(routeName);
  const onBack = () => (router.canGoBack() ? router.back() : router.replace('/tabs/profile' as never));

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchAll();
    });
    return () => sub.remove();
  }, [fetchAll]);

  const requestsCount = useFriendsStore((s) => s.requestsRaw?.incoming?.length ?? 0);
  const displayName = user?.username || t('profile.labels.guest', 'Guest');

  const handleOpenProfile = useCallback(() => {
    router.push({ pathname: '/tabs/profile' });
  }, [router]);

  return (
    <YStack bg="$background" pt={insets.top}>
      <XStack h={50} ai="center" jc="space-between" px="$4">
        <XStack ai="center" gap="$2">
          {isSub && (
            <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back', 'Back')} style={{ minHeight: 44, justifyContent: 'center' }}>
              <XStack ai="center" gap="$1">
                <ChevronLeft size={22} color="$gray11" />
                <Text fontSize={14} color="$gray11">{t('common.back', 'Back')}</Text>
              </XStack>
            </Pressable>
          )}
          {showHomeShortcut && !isSub && (
            <Pressable onPress={onBackToHome} hitSlop={10}>
              <XStack ai="center" gap="$1">
                <ChevronLeft size={20} color="$gray11" />
                <Text fontSize={14} color="$gray11">
                  {t('navigation.mainMenu', 'Main menu')}
                </Text>
              </XStack>
            </Pressable>
          )}
          <Text fontSize={18} fontWeight="600" numberOfLines={1} miw={150}>
            {props.options.title}
          </Text>
        </XStack>

        <XStack ai="center" gap="$3">
          <Pressable onPress={() => router.push('/tabs/friends/requests')}>
            <View>
              <Bell size={22} color="$gray11" />
              <DotBadge value={requestsCount} />
            </View>
          </Pressable>

          <Pressable onPress={handleOpenProfile} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('profile.title', 'Profile')}>
            <ProfileAvatar uri={user?.avatarUrl} name={displayName} seed={user?.uniqueId} size={36} />
          </Pressable>
        </XStack>
      </XStack>
    </YStack>
  );
}

export default function TabLayout() {
  const { user } = useAppStore();
  const { t } = useTranslation();

  const greetingName = user?.username || t('home.header.friendFallback', 'friend');
  const homeTitle = t('home.header.greeting', { name: greetingName });
  const homeLabel = t('navigation.tabs.home', 'Home');
  const settingsTitle = t('navigation.tabs.settings', 'Settings');
  const profileTitle = t('profile.title', 'Profile');
  const groupsTitle = t('navigation.groups.title', 'Groups');
  const newGroupTitle = t('navigation.groups.create', 'New group');
  const groupDetailsTitle = t('navigation.groups.details', 'Group');
  const scanInviteTitle = t('navigation.scanInvite', 'Scan Invite');
  const friendQrTitle = t('navigation.friendQr', 'My Friend QR');
  const groupQrTitle = t('navigation.groupQr', 'Group QR');
  const newReceiptTitle = t('navigation.newReceipt', 'New receipt');
  const receiptReviewTitle = t('navigation.receiptReview', 'Check receipt');
  const manualEntryTitle = t('navigation.manualEntry', 'Enter manually');
  const participantsTitle = t('navigation.participants', 'Participants');
  const itemsSplitTitle = t('navigation.itemsSplit', 'Items Split');
  const finishTitle = t('navigation.finish', 'Finish');
  const historyTitle = t('navigation.history', 'Recent bills');
  const historyDetailsTitle = t('navigation.historyDetails', 'Bill details');

  return (
    <Tabs
      screenOptions={{
        header: (props) => <GlobalTabsHeader {...props} />,
        tabBarStyle: { display: 'none' },
      }}
    >
      {/* Home & Settings tabs (hidden from bar) */}
      <Tabs.Screen
        name="index"
        options={{
          href: null,
          title: homeTitle,
          tabBarLabel: homeLabel,
          tabBarIcon: ({ color, size }) => <Home size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          title: settingsTitle,
          tabBarLabel: settingsTitle,
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color as string} />,
        }}
      />

      <Tabs.Screen name="profile" options={{ href: null, title: profileTitle }} />
      <Tabs.Screen name="profile-edit" options={{ href: null, title: t('profile.actions.edit', 'Edit profile') }} />
      <Tabs.Screen name="profile-qr" options={{ href: null, title: t('profile.qr.title', 'My QR code') }} />
      <Tabs.Screen name="settings-email" options={{ href: null, title: t('settings.email.title', 'Change email') }} />
      <Tabs.Screen name="settings-password" options={{ href: null, title: t('settings.password.title', 'Change password') }} />
      <Tabs.Screen name="settings-language" options={{ href: null, title: t('settings.language.title', 'Language') }} />
      <Tabs.Screen name="settings-currency" options={{ href: null, title: t('settings.bills.currency', 'Default currency') }} />
      <Tabs.Screen name="settings-delete" options={{ href: null, title: t('settings.delete.title', 'Delete account') }} />
      <Tabs.Screen name="about" options={{ href: null, title: t('settings.about.title', 'About the app') }} />
      <Tabs.Screen name="legal" options={{ href: null, title: t('settings.about.title', 'About the app') }} />

      {/* Friends stack (hidden) */}
      <Tabs.Screen name="friends/index" options={{ href: null, title: t('friends.title', 'Friends') }} />
      <Tabs.Screen name="friends/search" options={{ href: null, title: t('friends.searchTitle', 'Search') }} />
      <Tabs.Screen name="friends/requests" options={{ href: null, title: t('friends.requestsTitle', 'Requests') }} />

      {/* HIDDEN: Groups */}
      <Tabs.Screen name="groups/index"   options={{ href: null, title: groupsTitle }} />
      <Tabs.Screen name="groups/create"  options={{ href: null, title: newGroupTitle }} />
      <Tabs.Screen name="groups/[groupId]" options={{ href: null, title: groupDetailsTitle }} />

      <Tabs.Screen name="scan-invite" options={{ href: null, title: scanInviteTitle }} />
      <Tabs.Screen name="friends/invite" options={{ href: null, title: friendQrTitle }} />
      <Tabs.Screen name="groups/invite" options={{ href: null, title: groupQrTitle }} />

      <Tabs.Screen name="new-receipt" options={{ href: null, title: newReceiptTitle }} />
      <Tabs.Screen name="scan-camera" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="scan-preview" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="scan-processing" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="receipt-review" options={{ href: null, title: receiptReviewTitle }} />
      <Tabs.Screen name="receipt-manual" options={{ href: null, title: manualEntryTitle }} />
      <Tabs.Screen name="sessions/participants" options={{ href: null, title: participantsTitle }} />
      <Tabs.Screen name="sessions/items-split" options={{ href: null, title: itemsSplitTitle }} />
      <Tabs.Screen name="sessions/finish" options={{ href: null, title: finishTitle }} />
      <Tabs.Screen name="sessions/history/index" options={{ href: null, title: historyTitle }} />
      <Tabs.Screen name="sessions/history/[historyId]" options={{ href: null, title: historyDetailsTitle }} />

    </Tabs>
  );
}
