import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, QrCode, Settings as SettingsIcon, Wallet } from '@tamagui/lucide-icons';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors } from '@/shared/lib/theme/use-colors';
import { getCurrentUser } from '@/features/auth/api';
import { useFriendsStore } from '@/features/friends/model/friends.store';
import { useGroupsStore } from '@/features/groups/model/groups.store';
import { useSessionsHistoryStore } from '@/features/sessions/model/history.store';
import { haptics } from '@/shared/lib/haptics';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { Button, Card, FadeIn, Row, Screen, Section, Skeleton } from '@/features/profile/ui/kit';
import { radius, space } from '@/shared/ui/tokens';

function Stat({ value, label }: { value: number | null; label: string }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`${label}: ${value ?? '—'}`} style={{ flex: 1, alignItems: 'center', paddingVertical: space.md, gap: 2 }}>
      {value === null ? <Skeleton width={28} height={22} /> : <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 22, fontWeight: '800' }}>{value}</Text>}
      <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);

  const friends = useFriendsStore((s) => s.friends);
  const friendsLoaded = useFriendsStore((s) => s.requestsRaw !== null);
  const fetchFriends = useFriendsStore((s) => s.fetchAll);
  const groups = useGroupsStore((s) => s.groups);
  const fetchGroups = useGroupsStore((s) => s.fetchGroups);
  const bills = useSessionsHistoryStore((s) => s.count);
  const billsLoaded = useSessionsHistoryStore((s) => s.initialized);
  const fetchHistory = useSessionsHistoryStore((s) => s.fetchHistory);

  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    // profile + the three numbers; a failed part does not hide the rest
    const results = await Promise.allSettled([
      getCurrentUser().then(setUser),
      fetchFriends(),
      fetchGroups(),
      fetchHistory(undefined, true),
    ]);
    if (results[0].status === 'rejected') {
      const reason = results[0].reason as { message?: string } | undefined;
      setLoadError(reason?.message || t('errors.unexpected', 'Something went wrong'));
    }
  }, [fetchFriends, fetchGroups, fetchHistory, setUser, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const copyId = useCallback(async () => {
    if (!user?.uniqueId) return;
    await Clipboard.setStringAsync(user.uniqueId);
    haptics.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [user?.uniqueId]);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} keyboard={false}>
      <FadeIn>
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
          {user ? (
            <>
              <ProfileAvatar uri={user.avatarUrl} name={user.username} seed={user.uniqueId} size={104} onPress={() => router.push('/tabs/profile-edit')} />
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{user.username}</Text>
                <Text selectable maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 15 }}>{user.email}</Text>
              </View>
              <Pressable
                onPress={copyId}
                accessibilityRole="button"
                accessibilityLabel={t('profile.id.copyA11y', { id: user.uniqueId, defaultValue: 'Your ID {{id}}. Copy' })}
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: c.field, borderWidth: 1, borderColor: c.border }}
              >
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 16, fontWeight: '700', letterSpacing: 0.5 }}>{user.uniqueId}</Text>
                <Copy size={16} color={copied ? c.accentText : c.textMuted} />
                <Text maxFontSizeMultiplier={1.4} style={{ color: copied ? c.accentText : c.textMuted, fontSize: 13 }}>{copied ? t('profile.id.copied', 'Copied') : t('profile.id.copy', 'Copy')}</Text>
              </Pressable>
            </>
          ) : (
            <View style={{ alignItems: 'center', gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}>
              <Skeleton width={104} height={104} round />
              <Skeleton width={160} height={24} />
              <Skeleton width={200} height={16} />
            </View>
          )}
        </Card>
      </FadeIn>

      {loadError && !user && (
        <Card style={{ gap: space.md }}>
          <Text style={{ color: c.danger, fontSize: 14 }}>{loadError}</Text>
          <Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void load()} />
        </Card>
      )}

      <FadeIn delay={60}>
        <Card style={{ flexDirection: 'row', paddingVertical: space.xs, paddingHorizontal: space.sm }}>
          <Stat value={friendsLoaded ? friends.length : null} label={t('profile.stats.friends', 'Friends')} />
          <View style={{ width: 1, backgroundColor: c.border, marginVertical: space.md }} />
          <Stat value={groups.length > 0 || friendsLoaded ? groups.length : null} label={t('profile.stats.groups', 'Groups')} />
          <View style={{ width: 1, backgroundColor: c.border, marginVertical: space.md }} />
          <Stat value={billsLoaded ? bills : null} label={t('profile.stats.bills', 'Bills')} />
        </Card>
      </FadeIn>

      <FadeIn delay={120} style={{ gap: space.md }}>
        <Button title={t('profile.actions.edit', 'Edit profile')} icon={<Pencil size={18} color="#FFFFFF" />} onPress={() => router.push('/tabs/profile-edit')} />
        <Button variant="secondary" title={t('profile.actions.qr', 'QR code & share')} icon={<QrCode size={18} color={c.text} />} onPress={() => router.push('/tabs/profile-qr')} />
      </FadeIn>

      <FadeIn delay={180}>
        <Section>
          <Row
            icon={<Wallet size={22} color={c.accentText} />}
            label={t('finance.title', 'Finances')}
            subtitle={t('finance.profileHint', 'Who owes you, what you owe, statements')}
            onPress={() => router.push('/tabs/finances' as never)}
          />
          <Row
            icon={<SettingsIcon size={22} color={c.accentText} />}
            label={t('profile.actions.settings', 'Settings')}
            subtitle={t('profile.actions.settingsHint', 'Account, appearance, language, data')}
            onPress={() => router.push('/tabs/settings')}
          />
        </Section>
      </FadeIn>
    </Screen>
  );
}
