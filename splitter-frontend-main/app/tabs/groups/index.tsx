import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Plus, Users } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { isApiError } from '@/shared/api/api-error';
import { radius, space } from '@/shared/ui/tokens';
import { Banner, Button, Card, FadeIn, Skeleton } from '@/features/profile/ui/kit';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { EmptyState, PillButton, SearchField, Segmented } from '@/features/social/ui/parts';
import { useGroupsStore } from '@/features/groups/model/groups.store';
import type { Group, Invitation } from '@/features/groups/api/groups.api';
import { socialErrorKey } from '@/features/social/lib/errors';
import { useOnline } from '@/features/social/lib/use-online';
import { useNotice } from '@/features/social/lib/use-notice';

type Tab = 'groups' | 'invitations';

const Collage = ({ group }: { group: Group }) => {
  const c = useColors();
  const members = (group.members ?? []).slice(0, 3);
  return (
    <View style={{ width: 44 + 14 * Math.max(0, members.length - 1), height: 44, justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
      {members.map((m, i) => (
        <View key={m.uniqueId} style={{ position: 'absolute', left: i * 14, borderRadius: 22, borderWidth: 2, borderColor: c.surface }}>
          <ProfileAvatar uri={m.avatarUrl} name={m.username} seed={m.uniqueId} size={i === 0 ? 40 : 36} />
        </View>
      ))}
    </View>
  );
};

const GroupCard = memo(function GroupCard({ group, locale, onOpen }: { group: Group; locale: string; onOpen: (g: Group) => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const count = group.counts?.members ?? group.members?.length ?? 0;
  const last = group.lastSession ? new Date(group.lastSession.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : null;
  const isOwner = group.myRole === 'owner';
  return (
    <Pressable
      onPress={() => { haptics.selection(); onOpen(group); }}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}. ${t('social.group.memberCount', { count, defaultValue: '{{count}} members' })}${last ? `. ${t('social.group.lastBill', { date: last, defaultValue: 'Last bill {{date}}' })}` : ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72 }}>
        <Collage group={group} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{group.name}</Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>
            {t('social.group.memberCount', { count, defaultValue: '{{count}} members' })}
            {last ? ` · ${t('social.group.lastBill', { date: last, defaultValue: 'Last bill {{date}}' })}` : ''}
          </Text>
        </View>
        {isOwner && (
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.accentSurface }} importantForAccessibility="no-hide-descendants">
            <Text maxFontSizeMultiplier={1.2} style={{ color: c.accentText, fontSize: 12, fontWeight: '800' }}>{t('social.group.owner', 'Owner')}</Text>
          </View>
        )}
      </Card>
    </Pressable>
  );
});

export default function GroupsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const locale = useAppStore((s) => s.language) || 'en';
  const online = useOnline();
  const groups = useGroupsStore((s) => s.groups);
  const loaded = useGroupsStore((s) => s.loaded);
  const errorKey = useGroupsStore((s) => s.errorKey);
  const invitations = useGroupsStore((s) => s.invitations);
  const fetchGroups = useGroupsStore((s) => s.fetchGroups);
  const fetchInvitations = useGroupsStore((s) => s.fetchInvitations);
  const accept = useGroupsStore((s) => s.acceptInvitation);
  const decline = useGroupsStore((s) => s.declineInvitation);

  const [tab, setTab] = useState<Tab>(params.tab === 'invitations' ? 'invitations' : 'groups');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [notice, notify] = useNotice();

  const load = useCallback(() => Promise.all([fetchGroups(), fetchInvitations()]), [fetchGroups, fetchInvitations]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? groups.filter((g) => g.name.toLowerCase().includes(s)) : groups;
  }, [groups, q]);

  const open = useCallback((g: Group) => router.push({ pathname: '/tabs/groups/[groupId]', params: { groupId: String(g.id) } } as never), [router]);

  const answer = async (inv: Invitation, ok: boolean) => {
    if (busy[inv.id]) return;
    if (!online) return notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') });
    setBusy((b) => ({ ...b, [inv.id]: true }));
    try {
      await (ok ? accept(inv) : decline(inv));
      haptics.success();
      notify({ kind: 'success', text: ok ? t('social.invitations.joined', { group: inv.group.name, defaultValue: 'You joined “{{group}}”.' }) : t('social.invitations.declined', 'Invitation declined.') });
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: t(socialErrorKey(isApiError(e) ? e : {}), 'Something went wrong') });
    } finally {
      setBusy((b) => ({ ...b, [inv.id]: false }));
    }
  };

  const pending = invitations?.length ?? 0;
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accentText} colors={[c.accentText]} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}>
      <FadeIn style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm }}>
        <Segmented value={tab} onChange={setTab} options={[{ key: 'groups', label: t('social.tabs.groups', 'Groups') }, { key: 'invitations', label: t('social.tabs.invitations', 'Invitations'), badge: pending }]} />
        {notice && <Banner kind={notice.kind === 'error' ? 'error' : 'success'}>{notice.text}</Banner>}
      </FadeIn>

      {tab === 'groups' ? (
        !loaded && !errorKey ? (
          <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}>{[0, 1, 2].map((i) => <Skeleton key={i} height={72} style={{ borderRadius: radius.card }} />)}</View>
        ) : !loaded && errorKey ? (
          <EmptyState title={t('social.loadError', "Couldn't load")} message={t(errorKey, 'Something went wrong')}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void load()} /></EmptyState>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(g) => String(g.id)}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}
            ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
            ListHeaderComponent={
              <View style={{ gap: space.md, paddingBottom: space.md }}>
                <Button icon={<Plus size={18} color={c.onAccent} />} title={t('social.group.new', 'New group')} onPress={() => router.push('/tabs/groups/create' as never)} />
                {groups.length > 1 && <SearchField value={q} onChangeText={setQ} label={t('social.group.searchLabel', 'Search your groups')} placeholder={t('social.group.searchPlaceholder', 'Search groups')} />}
              </View>
            }
            renderItem={({ item }) => <GroupCard group={item} locale={locale} onOpen={open} />}
            ListEmptyComponent={
              groups.length === 0
                ? <EmptyState icon={<Users size={30} color={c.accentText} />} title={t('social.group.emptyTitle', 'No groups yet')} message={t('social.group.emptyMessage', 'Create a group for a trip, a flat or a regular dinner.')} />
                : <EmptyState title={t('social.group.noMatch', 'No groups match')} />
            }
          />
        )
      ) : (
        <FlatList
          data={invitations ?? []}
          keyExtractor={(i) => String(i.id)}
          refreshControl={refreshControl}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          renderItem={({ item }) => (
            <Card style={{ gap: space.md }}>
              <View style={{ gap: 2 }}>
                <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>{item.group.name}</Text>
                <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14 }}>{t('social.invitations.from', { name: item.inviter.username, id: item.inviter.uniqueId, defaultValue: 'Invited by {{name}} ({{id}})' })}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
                <PillButton kind="secondary" title={t('social.action.decline', 'Decline')} a11yLabel={t('social.invitations.declineA11y', { group: item.group.name, defaultValue: 'Decline invitation to {{group}}' })} disabled={!!busy[item.id] || !online} onPress={() => void answer(item, false)} />
                <PillButton title={t('social.action.accept', 'Accept')} a11yLabel={t('social.invitations.acceptA11y', { group: item.group.name, defaultValue: 'Accept invitation to {{group}}' })} loading={!!busy[item.id]} disabled={!online} onPress={() => void answer(item, true)} />
              </View>
            </Card>
          )}
          ListEmptyComponent={invitations === null
            ? <View style={{ gap: space.md }}><Skeleton height={96} style={{ borderRadius: radius.card }} /></View>
            : <EmptyState icon={<Users size={30} color={c.accentText} />} title={t('social.invitations.emptyTitle', 'No invitations')} message={t('social.invitations.emptyMessage', 'When someone invites you to a group, it appears here. You join only if you accept.')} />}
        />
      )}
    </KeyboardAvoidingView>
  );
}
