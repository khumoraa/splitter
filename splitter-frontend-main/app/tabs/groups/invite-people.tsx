import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { haptics } from '@/shared/lib/haptics';
import { isApiError } from '@/shared/api/api-error';
import { radius, space } from '@/shared/ui/tokens';
import { Banner, Button, Skeleton } from '@/features/profile/ui/kit';
import { Check, EmptyState, PillButton, SearchField, Segmented, UserRow } from '@/features/social/ui/parts';
import { useFriendsStore } from '@/features/friends/model/friends.store';
import { useGroupsStore } from '@/features/groups/model/groups.store';
import type { SearchHit, User } from '@/features/friends/model/types';
import { filterFriends } from '@/features/social/lib/friends-list';
import { inviteAction } from '@/features/social/lib/relation-ui';
import { groupPermissions } from '@/features/social/lib/permissions';
import { socialErrorKey } from '@/features/social/lib/errors';
import { useOnline } from '@/features/social/lib/use-online';
import { useNotice } from '@/features/social/lib/use-notice';
import { useUserSearch } from '@/features/social/lib/use-user-search';

type Mode = 'friends' | 'anyone';

export default function InvitePeopleScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const gid = Number(groupId);
  const online = useOnline();
  const current = useGroupsStore((s) => s.current);
  const sent = useGroupsStore((s) => s.sent);
  const openGroup = useGroupsStore((s) => s.openGroup);
  const addMembers = useGroupsStore((s) => s.addMembers);
  const invite = useGroupsStore((s) => s.invite);
  const cancelInvitation = useGroupsStore((s) => s.cancelInvitation);
  const friends = useFriendsStore((s) => s.friends);
  const fetchFriends = useFriendsStore((s) => s.fetchAll);
  const { state, setQuery, loadMore, retry, refresh } = useUserSearch(gid);

  const [mode, setMode] = useState<Mode>('friends');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [pickedFriends, setPickedFriends] = useState<Record<string, boolean>>({});
  const [pickedPeople, setPickedPeople] = useState<Record<number, SearchHit>>({});
  const [busy, setBusy] = useState(false);
  const [notice, notify] = useNotice(7000);

  useFocusEffect(useCallback(() => { void openGroup(gid); void fetchFriends(); }, [openGroup, fetchFriends, gid]));

  const ready = current?.group.id === gid;
  const perms = groupPermissions(ready ? current!.role : null);
  const memberIds = useMemo(() => new Set((current?.members ?? []).map((m) => m.uniqueId)), [current]);
  const invitedIds = useMemo(() => new Set(sent.map((s) => s.invitee.uniqueId)), [sent]);

  const candidates = useMemo(() => filterFriends(friends.filter((f) => !memberIds.has(f.uniqueId)), q), [friends, memberIds, q]);
  const errText = (e: unknown) => t(socialErrorKey(isApiError(e) ? e : {}), 'Something went wrong');
  const countFriends = Object.values(pickedFriends).filter(Boolean).length;
  const countPeople = Object.keys(pickedPeople).length;

  const addFriends = async () => {
    if (busy || countFriends === 0) return;
    if (!online) return notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') });
    setBusy(true);
    try {
      const r = await addMembers(gid, Object.keys(pickedFriends).filter((k) => pickedFriends[k]));
      setPickedFriends({});
      haptics.success();
      const skipped = r.skipped.length;
      notify({ kind: skipped ? 'error' : 'success', text: skipped ? t('social.invite.addedSome', { added: r.added.length, skipped, defaultValue: 'Added {{added}}, skipped {{skipped}}.' }) : t('social.invite.added', { count: r.added.length, defaultValue: 'Added {{count}} to the group.' }) });
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const sendInvitations = async () => {
    if (busy || countPeople === 0) return;
    if (!online) return notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') });
    setBusy(true);
    let ok = 0;
    let firstError: unknown = null;
    for (const hit of Object.values(pickedPeople)) {
      try {
        await invite(gid, hit);
        ok++;
      } catch (e) {
        firstError ??= e;
        if (isApiError(e) && (e.code === 'INVITE_LIMIT' || e.code === 'GROUP_FULL' || e.kind === 'network')) break; // the rest would fail the same way
      }
    }
    setPickedPeople({});
    setBusy(false);
    refresh();
    if (ok > 0) haptics.success(); else haptics.error();
    const failed = countPeople - ok;
    notify(
      failed === 0
        ? { kind: 'success', text: t('social.invite.sent', { count: ok, defaultValue: 'Invitations sent: {{count}}.' }) }
        : { kind: 'error', text: `${ok ? t('social.invite.sent', { count: ok, defaultValue: 'Invitations sent: {{count}}.' }) + ' ' : ''}${errText(firstError)}` }
    );
  };

  const cancelFor = async (hit: SearchHit) => {
    const inv = sent.find((s) => s.invitee.uniqueId === hit.uniqueId);
    if (!inv || busy) return;
    setBusy(true);
    try {
      await cancelInvitation(gid, inv.id);
      haptics.success();
      refresh();
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleFriend = (u: User) => { haptics.selection(); setPickedFriends((p) => ({ ...p, [u.uniqueId]: !p[u.uniqueId] })); };
  const togglePerson = (h: SearchHit) => { haptics.selection(); setPickedPeople((p) => { const n = { ...p }; if (n[h.id]) delete n[h.id]; else n[h.id] = h; return n; }); };

  if (ready && !perms.canInvite) {
    return <View style={{ flex: 1, backgroundColor: c.screen, justifyContent: 'center' }}><EmptyState title={t('social.group.ownerOnlyInvite', 'Only the owner can invite people.')} /></View>;
  }

  const results = state.results;
  const emptyBody =
    state.status === 'idle' ? <EmptyState icon={<SearchIcon size={30} color={c.accentText} />} title={t('social.invite.idleTitle', 'Invite anyone')} message={t('social.invite.idleMessage', 'Search by username or ID. They get an invitation and join only if they accept.')} />
    : state.status === 'tooShort' ? <Text style={{ color: c.textMuted, fontSize: 15, textAlign: 'center', paddingVertical: space.xl }}>{t('social.find.tooShort', 'Type at least 2 characters, or a full ID like #1234.')}</Text>
    : state.status === 'loading' ? <View style={{ gap: space.sm }} accessibilityLabel={t('common.loading', 'Loading...')}>{[0, 1, 2].map((i) => <Skeleton key={i} height={64} style={{ borderRadius: radius.field }} />)}</View>
    : state.status === 'error' ? <EmptyState title={t('social.find.errorTitle', 'Search failed')} message={t(socialErrorKey({ code: state.errorCode ?? undefined, kind: state.errorCode === 'network' || state.errorCode === 'timeout' ? state.errorCode : undefined }), 'Something went wrong')}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={retry} /></EmptyState>
    : <EmptyState title={t('social.find.noneTitle', 'Nobody found')} message={t('social.find.noneMessage', 'Check the spelling. An ID like #1234 finds exactly one person.')} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <Segmented value={mode} onChange={setMode} options={[{ key: 'friends', label: t('social.invite.friendsTab', 'My friends') }, { key: 'anyone', label: t('social.invite.anyoneTab', 'Anyone') }]} />
        {notice && <Banner kind={notice.kind === 'error' ? 'error' : 'success'}>{notice.text}</Banner>}
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>
          {mode === 'friends' ? t('social.invite.friendsHint', 'Friends are added to the group at once.') : t('social.invite.anyoneHint', 'They will get an invitation and join only if they accept.')}
        </Text>
      </View>

      {mode === 'friends' ? (
        <FlatList
          data={candidates}
          keyExtractor={(f) => String(f.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
          ListHeaderComponent={friends.length > 0 ? <View style={{ paddingBottom: space.md }}><SearchField value={q} onChangeText={setQ} label={t('social.friends.searchLabel', 'Search your friends')} placeholder={t('social.friends.searchPlaceholder', 'Search friends')} /></View> : null}
          renderItem={({ item }) => {
            const on = !!pickedFriends[item.uniqueId];
            return (
              <Pressable onPress={() => toggleFriend(item)} accessibilityRole="checkbox" accessibilityLabel={`${item.username}, ${item.uniqueId}`} accessibilityState={{ checked: on }} style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: on ? c.accentFill : c.border, marginBottom: space.sm }}>
                <UserRow user={item} subtitle={invitedIds.has(item.uniqueId) ? t('social.invite.alreadyInvited', 'Invited') : undefined} right={<Check on={on} />} />
              </Pressable>
            );
          }}
          ListEmptyComponent={<EmptyState title={friends.length === 0 ? t('social.create.noFriends', 'No friends to add yet') : t('social.invite.allInGroup', 'Everyone you know is already here')} message={friends.length === 0 ? t('social.invite.useAnyone', 'Use the “Anyone” tab to invite people by username or ID.') : undefined} />}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(h) => String(h.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListHeaderComponent={<View style={{ paddingBottom: space.md }}><SearchField value={text} onChangeText={(v) => { setText(v); setQuery(v); }} label={t('social.find.label', 'Username or ID')} placeholder={t('social.find.placeholder', 'Username or ID (#1234)')} onSubmitEditing={() => retry()} /></View>}
          renderItem={({ item }) => {
            const a = inviteAction(item.groupStatus ?? 'none');
            const on = !!pickedPeople[item.id];
            return (
              <Pressable
                onPress={() => { if (a.kind === 'invite') togglePerson(item); }}
                disabled={a.kind !== 'invite'}
                accessibilityRole={a.kind === 'invite' ? 'checkbox' : 'text'}
                accessibilityLabel={`${item.username}, ${item.uniqueId}${a.kind !== 'invite' ? `. ${t(a.labelKey, a.kind)}` : ''}`}
                accessibilityState={a.kind === 'invite' ? { checked: on } : {}}
                style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: on ? c.accentFill : c.border, marginBottom: space.sm }}
              >
                <UserRow
                  user={item}
                  right={
                    a.kind === 'invite' ? <Check on={on} />
                    : a.kind === 'cancel' ? <PillButton kind="secondary" title={t(a.labelKey, 'Cancel invitation')} disabled={busy || !online} onPress={() => void cancelFor(item)} />
                    : <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 13, fontWeight: '600' }}>{t(a.labelKey, 'In the group')}</Text>
                  }
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={emptyBody}
          ListFooterComponent={results.length > 0 ? <View style={{ alignItems: 'center', paddingTop: space.md }}>{state.status === 'loadingMore' ? <ActivityIndicator color={c.accentText} /> : state.nextOffset !== null ? <PillButton kind="secondary" title={t('social.find.showMore', 'Show more')} onPress={loadMore} /> : null}</View> : null}
        />
      )}

      <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
        {mode === 'friends' ? (
          <Button title={countFriends ? t('social.invite.addN', { count: countFriends, defaultValue: 'Add {{count}} to the group' }) : t('social.invite.pickFriends', 'Choose friends')} loading={busy} disabled={countFriends === 0 || !online} onPress={() => void addFriends()} />
        ) : (
          <Button title={countPeople ? t('social.invite.inviteN', { count: countPeople, defaultValue: 'Invite {{count}}' }) : t('social.invite.pickPeople', 'Choose people to invite')} loading={busy} disabled={countPeople === 0 || !online} onPress={() => void sendInvitations()} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
