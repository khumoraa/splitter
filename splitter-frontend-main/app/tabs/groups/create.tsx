import React, { useCallback, useMemo, useState } from 'react';
import { useLeaveGuard } from '@/shared/lib/navigation/use-leave-guard';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/shared/lib/theme/use-colors';
import { haptics } from '@/shared/lib/haptics';
import { isApiError } from '@/shared/api/api-error';
import { space } from '@/shared/ui/tokens';
import { Banner, Button, Field } from '@/features/profile/ui/kit';
import { Check, EmptyState, SearchField, SectionTitle, UserRow } from '@/features/social/ui/parts';
import { useFriendsStore } from '@/features/friends/model/friends.store';
import { useGroupsStore } from '@/features/groups/model/groups.store';
import { filterFriends } from '@/features/social/lib/friends-list';
import { socialErrorKey } from '@/features/social/lib/errors';
import { useOnline } from '@/features/social/lib/use-online';

const MAX_NAME = 60;

export default function CreateGroupScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const friends = useFriendsStore((s) => s.friends);
  const fetchFriends = useFriendsStore((s) => s.fetchAll);
  const createGroup = useGroupsStore((s) => s.createGroup);

  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowLeave = useLeaveGuard({ dirty: name.trim() !== '' || Object.values(picked).some(Boolean), busy });

  useFocusEffect(useCallback(() => { void fetchFriends(); }, [fetchFriends]));

  const list = useMemo(() => filterFriends(friends, q), [friends, q]);
  const count = Object.values(picked).filter(Boolean).length;
  const valid = name.trim().length > 0 && name.trim().length <= MAX_NAME;

  const submit = async () => {
    if (busy || !valid) return;
    if (!online) return setError(t('social.errors.offline', 'No connection.'));
    setBusy(true);
    setError(null);
    try {
      const g = await createGroup(name, Object.keys(picked).filter((k) => picked[k]));
      haptics.success();
      allowLeave();
      router.replace({ pathname: '/tabs/groups/[groupId]', params: { groupId: String(g.id) } } as never);
    } catch (e) {
      haptics.error();
      setError(t(socialErrorKey(isApiError(e) ? e : {}), 'Something went wrong'));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}>
      <FlatList
        data={list}
        keyExtractor={(f) => String(f.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingBottom: space.md }}>
            {!!error && <Banner kind="error">{error}</Banner>}
            <Field
              label={t('social.create.name', 'Group name')}
              placeholder={t('social.create.namePlaceholder', 'e.g. Kyoto trip')}
              value={name}
              onChangeText={setName}
              autoCapitalize="sentences"
              maxLength={MAX_NAME}
              returnKeyType="done"
              helper={t('social.create.nameHelper', { n: name.trim().length, max: MAX_NAME, defaultValue: '{{n}} / {{max}}' })}
            />
            <SectionTitle>{t('social.create.addFriends', 'Add friends (optional)')}</SectionTitle>
            {friends.length > 0 && <SearchField value={q} onChangeText={setQ} label={t('social.friends.searchLabel', 'Search your friends')} placeholder={t('social.friends.searchPlaceholder', 'Search friends')} />}
          </View>
        }
        renderItem={({ item }) => {
          const on = !!picked[item.uniqueId];
          return (
            <Pressable
              onPress={() => { haptics.selection(); setPicked((p) => ({ ...p, [item.uniqueId]: !on })); }}
              accessibilityRole="checkbox"
              accessibilityLabel={`${item.username}, ${item.uniqueId}`}
              accessibilityState={{ checked: on }}
              style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: on ? c.accentFill : c.border, marginBottom: space.sm }}
            >
              <UserRow user={item} right={<Check on={on} />} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState title={friends.length === 0 ? t('social.create.noFriends', 'No friends to add yet') : t('social.friends.noMatch', 'No friends match')} message={friends.length === 0 ? t('social.create.noFriendsMessage', 'You can create the group now and invite people later, even if they are not your friends.') : undefined} />
        }
      />
      <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, gap: space.sm }}>
        {count > 0 && <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14, textAlign: 'center' }}>{t('social.create.selected', { count, defaultValue: '{{count}} selected' })}</Text>}
        <Button title={t('social.create.submit', 'Create group')} loading={busy} disabled={!valid || !online} onPress={() => void submit()} />
      </View>
    </KeyboardAvoidingView>
  );
}
