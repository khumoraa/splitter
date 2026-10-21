import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, RefreshControl, SectionList, Share, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Trash2, UserPlus, Users } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { space, radius } from '@/shared/ui/tokens';
import { isApiError } from '@/shared/api/api-error';
import { buildFriendIdLink } from '@/shared/lib/utils/invite';
import { Banner, Button, Card, Skeleton, FadeIn } from '@/features/profile/ui/kit';
import { EmptyState, PillButton, SearchField, Segmented, SectionTitle, UserRow } from '@/features/social/ui/parts';
import { useFriendsStore } from '@/features/friends/model/friends.store';
import type { SearchHit, User } from '@/features/friends/model/types';
import { friendAction } from '@/features/social/lib/relation-ui';
import { filterFriends, sectionizeFriends } from '@/features/social/lib/friends-list';
import { socialErrorKey } from '@/features/social/lib/errors';
import { useOnline } from '@/features/social/lib/use-online';
import { useNotice, type Notice } from '@/features/social/lib/use-notice';
import { useUserSearch } from '@/features/social/lib/use-user-search';

export type FriendsTab = 'friends' | 'requests' | 'find';

type Notify = (n: Notice | null) => void;

function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => t(socialErrorKey(isApiError(e) ? e : {}), 'Something went wrong');
}

// ---------------------------------------------------------------- friends tab

const FriendRow = memo(function FriendRow({ friend, onRemove }: { friend: User; onRemove: (f: User) => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const ref = useRef<{ close: () => void } | null>(null);
  const ask = () =>
    Alert.alert(t('social.friends.removeTitle', { name: friend.username, defaultValue: 'Remove {{name}}?' }), t('social.friends.removeMessage', 'You will no longer be friends. Shared bills are not deleted.'), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel', onPress: () => ref.current?.close() },
      { text: t('social.friends.remove', 'Remove'), style: 'destructive', onPress: () => onRemove(friend) },
    ]);
  return (
    <ReanimatedSwipeable
      ref={ref as never}
      overshootRight={false}
      rightThreshold={72}
      onSwipeableOpen={ask}
      renderRightActions={() => (
        <View importantForAccessibility="no-hide-descendants" style={{ width: 88, backgroundColor: c.dangerFill, alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={22} color={c.onDanger} />
        </View>
      )}
    >
      <View accessible accessibilityLabel={`${friend.username}, ${friend.uniqueId}`} accessibilityActions={[{ name: 'delete', label: t('social.friends.remove', 'Remove') }]} onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'delete') ask(); }} style={{ backgroundColor: c.surface }}>
        <UserRow user={friend} />
      </View>
    </ReanimatedSwipeable>
  );
});

function FriendsListTab({ goFind, notify }: { goFind: () => void; notify: Notify }) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const errText = useErrorText();
  const friends = useFriendsStore((s) => s.friends);
  const loaded = useFriendsStore((s) => s.requestsRaw !== null);
  const errorKey = useFriendsStore((s) => s.errorKey);
  const fetchAll = useFriendsStore((s) => s.fetchAll);
  const remove = useFriendsStore((s) => s.remove);
  const online = useOnline();
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const sections = useMemo(() => sectionizeFriends(filterFriends(friends, q)), [friends, q]);

  const onRemove = useCallback(async (f: User) => {
    if (!online) return notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') });
    try {
      await remove(f.uniqueId);
      haptics.success();
      notify({ kind: 'success', text: t('social.friends.removed', { name: f.username, defaultValue: '{{name}} was removed.' }) });
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: errText(e) });
    }
  }, [online, remove, notify, t, errText]);

  if (!loaded && !errorKey) {
    return (
      <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={56} style={{ borderRadius: radius.field }} />)}
      </View>
    );
  }
  if (!loaded && errorKey) {
    return <EmptyState title={t('social.loadError', "Couldn't load")} message={t(errorKey, 'Something went wrong')}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void fetchAll()} /></EmptyState>;
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(f) => String(f.id)}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchAll(); setRefreshing(false); }} tintColor={c.accentText} colors={[c.accentText]} />}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}
      ListHeaderComponent={friends.length > 0 ? (
        <View style={{ paddingBottom: space.md }}>
          <SearchField value={q} onChangeText={setQ} label={t('social.friends.searchLabel', 'Search your friends')} placeholder={t('social.friends.searchPlaceholder', 'Search friends')} />
        </View>
      ) : null}
      renderSectionHeader={({ section }) => (
        <View style={{ paddingTop: space.md, paddingBottom: space.xs }}><SectionTitle>{section.title}</SectionTitle></View>
      )}
      renderItem={({ item, index, section }) => (
        <View style={{ borderTopLeftRadius: index === 0 ? radius.card : 0, borderTopRightRadius: index === 0 ? radius.card : 0, borderBottomLeftRadius: index === section.data.length - 1 ? radius.card : 0, borderBottomRightRadius: index === section.data.length - 1 ? radius.card : 0, overflow: 'hidden', borderWidth: 1, borderTopWidth: index === 0 ? 1 : 0, borderColor: c.border, backgroundColor: c.surface }}>
          <FriendRow friend={item} onRemove={onRemove} />
        </View>
      )}
      ListEmptyComponent={
        friends.length === 0 ? (
          <EmptyState icon={<Users size={30} color={c.accentText} />} title={t('social.friends.emptyTitle', 'No friends yet')} message={t('social.friends.emptyMessage', 'Find people by username or ID and split bills together.')}>
            <Button title={t('social.friends.findCta', 'Find people')} icon={<UserPlus size={18} color={c.onAccent} />} onPress={goFind} />
          </EmptyState>
        ) : (
          <EmptyState title={t('social.friends.noMatch', 'No friends match')} message={t('social.friends.noMatchMessage', { query: q, defaultValue: 'Nobody in your list matches “{{query}}”.' })} />
        )
      }
      ListFooterComponent={friends.length > 0 ? <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, textAlign: 'center', marginTop: space.lg }}>{t('social.friends.swipeHint', 'Swipe a friend to the left to remove them.')}</Text> : null}
    />
  );
}

// ---------------------------------------------------------------- requests tab

type Row = { kind: 'in' | 'out'; id: number; user: User };

function RequestsTab({ notify }: { notify: Notify }) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const errText = useErrorText();
  const raw = useFriendsStore((s) => s.requestsRaw);
  const errorKey = useFriendsStore((s) => s.errorKey);
  const fetchAll = useFriendsStore((s) => s.fetchAll);
  const accept = useFriendsStore((s) => s.accept);
  const reject = useFriendsStore((s) => s.reject);
  const cancel = useFriendsStore((s) => s.cancel);
  const online = useOnline();
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  const run = async (userId: number, fn: () => Promise<unknown>, okText: string) => {
    if (busy[userId]) return; // double tap
    if (!online) return notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') });
    setBusy((b) => ({ ...b, [userId]: true }));
    try {
      await fn();
      haptics.success();
      notify({ kind: 'success', text: okText });
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: errText(e) });
    } finally {
      setBusy((b) => ({ ...b, [userId]: false }));
    }
  };

  if (!raw) {
    return errorKey
      ? <EmptyState title={t('social.loadError', "Couldn't load")} message={t(errorKey, 'Something went wrong')}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void fetchAll()} /></EmptyState>
      : <View style={{ padding: space.lg, gap: space.md }}><Skeleton height={96} style={{ borderRadius: radius.card }} /><Skeleton height={96} style={{ borderRadius: radius.card }} /></View>;
  }

  const sections = [
    { title: t('social.requests.incoming', 'Requests for you'), data: raw.incoming.map((r): Row => ({ kind: 'in', id: r.id, user: r.from })) },
    { title: t('social.requests.outgoing', 'Waiting for an answer'), data: raw.outgoing.map((r): Row => ({ kind: 'out', id: r.id, user: r.to })) },
  ].filter((s) => s.data.length > 0);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(r) => `${r.kind}${r.id}`}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchAll(); setRefreshing(false); }} tintColor={c.accentText} colors={[c.accentText]} />}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.sm }}
      renderSectionHeader={({ section }) => <View style={{ paddingTop: space.md, paddingBottom: space.xs }}><SectionTitle>{section.title}</SectionTitle></View>}
      renderItem={({ item }) => (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <UserRow user={item.user} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
            {item.kind === 'in' ? (
              <>
                <PillButton kind="secondary" title={t('social.action.decline', 'Decline')} a11yLabel={t('social.action.declineA11y', { name: item.user.username, defaultValue: 'Decline request from {{name}}' })} disabled={!!busy[item.user.id]} onPress={() => void run(item.user.id, () => reject(item.user), t('social.requests.declined', 'Request declined.'))} />
                <PillButton title={t('social.action.accept', 'Accept')} a11yLabel={t('social.action.acceptA11y', { name: item.user.username, defaultValue: 'Accept request from {{name}}' })} loading={!!busy[item.user.id]} onPress={() => void run(item.user.id, () => accept(item.user), t('social.requests.accepted', { name: item.user.username, defaultValue: 'You and {{name}} are friends now.' }))} />
              </>
            ) : (
              <PillButton kind="secondary" title={t('social.action.cancelRequest', 'Cancel request')} a11yLabel={t('social.action.cancelRequestA11y', { name: item.user.username, defaultValue: 'Cancel request to {{name}}' })} loading={!!busy[item.user.id]} onPress={() => void run(item.user.id, () => cancel(item.user.uniqueId), t('social.requests.cancelled', 'Request cancelled.'))} />
            )}
          </View>
        </Card>
      )}
      ListEmptyComponent={<EmptyState icon={<UserPlus size={30} color={c.accentText} />} title={t('social.requests.emptyTitle', 'No requests')} message={t('social.requests.emptyMessage', 'Friend requests you send or receive appear here.')} />}
    />
  );
}

// ---------------------------------------------------------------- find tab

function MyIdCard({ notify }: { notify: Notify }) {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const me = useAppStore((s) => s.user);
  if (!me?.uniqueId) return null;
  const copy = async () => {
    await Clipboard.setStringAsync(me.uniqueId);
    haptics.success();
    notify({ kind: 'success', text: t('social.find.copied', 'Your ID was copied.') });
  };
  const share = () => {
    void Share.share({ message: t('social.find.shareMessage', { id: me.uniqueId, link: buildFriendIdLink(me.uniqueId), defaultValue: 'Add me on Splitter: {{id}}\n{{link}}' }) });
  };
  return (
    <Card style={{ gap: space.md }}>
      <SectionTitle>{t('social.find.myId', 'Your ID')}</SectionTitle>
      <Text selectable maxFontSizeMultiplier={1.3} style={{ color: c.text, fontSize: 28, fontWeight: '800', letterSpacing: 0.5 }}>{me.uniqueId}</Text>
      <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14, lineHeight: 20 }}>{t('social.find.myIdHint', 'Friends can find you by this ID or by your username.')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <PillButton kind="secondary" title={t('social.find.copy', 'Copy')} onPress={() => void copy()} />
        <PillButton kind="secondary" title={t('social.find.share', 'Share')} onPress={share} />
        <PillButton kind="secondary" title={t('social.find.qr', 'My QR')} onPress={() => router.push('/tabs/profile-qr' as never)} />
        <PillButton kind="secondary" title={t('social.find.link', 'Invite link')} onPress={() => router.push('/tabs/friends/invite' as never)} />
      </View>
    </Card>
  );
}

function FindTab({ notify }: { notify: Notify }) {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const errText = useErrorText();
  const online = useOnline();
  const send = useFriendsStore((s) => s.send);
  const cancel = useFriendsStore((s) => s.cancel);
  const accept = useFriendsStore((s) => s.accept);
  const { state, setQuery, loadMore, retry, refresh } = useUserSearch();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  const onChange = (v: string) => { setText(v); setQuery(v); };

  const paste = async () => {
    const clip = (await Clipboard.getStringAsync()).split('\n')[0]?.trim().slice(0, 64) ?? '';
    if (clip) onChange(clip);
  };

  const act = async (hit: SearchHit) => {
    const a = friendAction(hit.relation);
    if (!a.enabled || busy[hit.id]) return;
    if (!online) return notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') });
    setBusy((b) => ({ ...b, [hit.id]: true }));
    try {
      if (a.kind === 'add') {
        const r = await send(hit.uniqueId);
        notify({ kind: 'success', text: r === 'accepted' ? t('social.requests.accepted', { name: hit.username, defaultValue: 'You and {{name}} are friends now.' }) : t('social.find.sent', { name: hit.username, defaultValue: 'Request sent to {{name}}.' }) });
      } else if (a.kind === 'cancel') {
        await cancel(hit.uniqueId);
        notify({ kind: 'success', text: t('social.requests.cancelled', 'Request cancelled.') });
      } else if (a.kind === 'accept') {
        await accept(hit);
        notify({ kind: 'success', text: t('social.requests.accepted', { name: hit.username, defaultValue: 'You and {{name}} are friends now.' }) });
      }
      haptics.success();
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: errText(e) });
    } finally {
      setBusy((b) => ({ ...b, [hit.id]: false }));
      refresh(); // the relation changed (or the server disagreed): show the truth
    }
  };

  const showResults = state.results.length > 0;
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <SearchField value={text} onChangeText={onChange} label={t('social.find.label', 'Username or ID')} placeholder={t('social.find.placeholder', 'Username or ID (#1234)')} onSubmitEditing={() => retry()} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <PillButton kind="secondary" title={t('social.find.paste', 'Paste')} a11yLabel={t('social.find.pasteA11y', 'Paste an ID from the clipboard')} onPress={() => void paste()} />
        <PillButton kind="secondary" title={t('social.find.scan', 'Scan QR')} a11yLabel={t('social.find.scanA11y', "Scan another person's QR code")} onPress={() => router.push('/tabs/scan-invite' as never)} />
      </View>
    </View>
  );

  let body: React.ReactNode = null;
  if (state.status === 'idle') {
    body = <View style={{ gap: space.lg }}><EmptyState icon={<SearchIcon size={30} color={c.accentText} />} title={t('social.find.idleTitle', 'Find people')} message={t('social.find.idleMessage', 'Type a username or an ID like #1234. Several people can share a username; the ID is always exact.')} /><MyIdCard notify={notify} /></View>;
  } else if (state.status === 'tooShort') {
    body = <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15, textAlign: 'center', paddingVertical: space.xl }}>{t('social.find.tooShort', 'Type at least 2 characters, or a full ID like #1234.')}</Text>;
  } else if (state.status === 'loading' && !showResults) {
    body = <View style={{ gap: space.sm }} accessibilityLabel={t('common.loading', 'Loading...')}>{[0, 1, 2].map((i) => <Skeleton key={i} height={64} style={{ borderRadius: radius.field }} />)}</View>;
  } else if (state.status === 'error' && !showResults) {
    const key = socialErrorKey({ code: state.errorCode ?? undefined, kind: state.errorCode === 'network' || state.errorCode === 'timeout' ? state.errorCode : undefined });
    body = <EmptyState title={t('social.find.errorTitle', 'Search failed')} message={t(key, 'Something went wrong')}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={retry} /></EmptyState>;
  } else if (state.status === 'done' && !showResults) {
    body = <EmptyState icon={<SearchIcon size={30} color={c.accentText} />} title={t('social.find.noneTitle', 'Nobody found')} message={t('social.find.noneMessage', 'Check the spelling. An ID like #1234 finds exactly one person.')} />;
  }

  return (
    <FlatList
      data={showResults ? state.results : []}
      keyExtractor={(h) => String(h.id)}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      renderItem={({ item }) => {
        const a = friendAction(item.relation);
        return (
          <Card style={{ padding: 0, opacity: state.status === 'loading' ? 0.6 : 1 }}>
            <UserRow
              user={item}
              right={
                a.kind === 'friends'
                  ? <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 14, fontWeight: '600' }}>{t(a.labelKey, 'Friends')}</Text>
                  : <PillButton kind={a.kind === 'cancel' ? 'secondary' : 'primary'} title={t(a.labelKey, a.kind)} a11yLabel={`${t(a.labelKey, a.kind)}: ${item.username}`} loading={!!busy[item.id]} disabled={!online} onPress={() => void act(item)} />
              }
            />
          </Card>
        );
      }}
      ListEmptyComponent={body}
      ListFooterComponent={
        showResults ? (
          <View style={{ paddingTop: space.lg, alignItems: 'center' }}>
            {state.status === 'loadingMore' ? <ActivityIndicator color={c.accentText} /> : state.nextOffset !== null ? <PillButton kind="secondary" title={t('social.find.showMore', 'Show more')} onPress={loadMore} /> : null}
            {!online && <Text style={{ color: c.textMuted, fontSize: 13, marginTop: space.md }}>{t('social.offlineActions', "You're offline: actions are disabled.")}</Text>}
          </View>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------- screen

export function FriendsView({ initialTab = 'friends' }: { initialTab?: FriendsTab }) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<FriendsTab>(initialTab);
  const [notice, notify] = useNotice();
  const incoming = useFriendsStore((s) => s.requestsRaw?.incoming.length ?? 0);
  const fetchAll = useFriendsStore((s) => s.fetchAll);

  useFocusEffect(useCallback(() => { void fetchAll(); }, [fetchAll]));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}>
      <FadeIn style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'friends', label: t('social.tabs.friends', 'Friends') },
            { key: 'requests', label: t('social.tabs.requests', 'Requests'), badge: incoming },
            { key: 'find', label: t('social.tabs.find', 'Find') },
          ]}
        />
        {notice && <Banner kind={notice.kind === 'error' ? 'error' : 'success'}>{notice.text}</Banner>}
      </FadeIn>
      <View style={{ flex: 1 }}>
        {tab === 'friends' && <FriendsListTab goFind={() => setTab('find')} notify={notify} />}
        {tab === 'requests' && <RequestsTab notify={notify} />}
        {tab === 'find' && <FindTab notify={notify} />}
      </View>
    </KeyboardAvoidingView>
  );
}
