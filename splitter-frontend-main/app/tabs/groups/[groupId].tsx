import React, { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useTranslation } from 'react-i18next';
import { Link2, MoreHorizontal, UserPlus } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { isApiError } from '@/shared/api/api-error';
import { radius, space } from '@/shared/ui/tokens';
import { Banner, Button, Card, Field, Row, Screen, Section, Skeleton, FadeIn } from '@/features/profile/ui/kit';
import { EmptyState, IconBtn, PillButton, SectionTitle, UserRow } from '@/features/social/ui/parts';
import { useGroupsStore } from '@/features/groups/model/groups.store';
import type { GroupMember } from '@/features/groups/api/groups.api';
import { deleteConfirmed, deniedReasonKey, groupPermissions } from '@/features/social/lib/permissions';
import { socialErrorKey } from '@/features/social/lib/errors';
import { showSheet } from '@/features/social/lib/sheet';
import { useOnline } from '@/features/social/lib/use-online';
import { useNotice } from '@/features/social/lib/use-notice';

export default function GroupScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const gid = Number(groupId);
  const me = useAppStore((s) => s.user);
  const online = useOnline();
  const current = useGroupsStore((s) => s.current);
  const sent = useGroupsStore((s) => s.sent);
  const loading = useGroupsStore((s) => s.loading);
  const errorKey = useGroupsStore((s) => s.errorKey);
  const store = useGroupsStore.getState;
  const openGroup = useGroupsStore((s) => s.openGroup);

  const [notice, notify] = useNotice();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { void openGroup(gid); }, [openGroup, gid]));

  const ready = current?.group.id === gid;
  const role = ready ? current!.role : null;
  const perms = groupPermissions(role);
  const members = ready ? current!.members : [];
  const name = ready ? current!.group.name : '';

  const guard = async (fn: () => Promise<unknown>, okText?: string, after?: () => void): Promise<boolean> => {
    if (busy) return false;
    if (!online) { notify({ kind: 'error', text: t('social.errors.offline', 'No connection.') }); return false; }
    setBusy(true);
    try {
      await fn();
      haptics.success();
      if (okText) notify({ kind: 'success', text: okText });
      after?.();
      return true;
    } catch (e) {
      haptics.error();
      notify({ kind: 'error', text: t(socialErrorKey(isApiError(e) ? e : {}), 'Something went wrong') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goInvite = () => router.push({ pathname: '/tabs/groups/invite-people', params: { groupId: String(gid) } } as never);
  const goLink = () => router.push({ pathname: '/tabs/groups/invite', params: { groupId: String(gid) } } as never);

  const memberMenu = (m: GroupMember) =>
    showSheet(
      m.username,
      [
        { label: t('social.group.makeOwner', 'Make owner'), onPress: () => confirmTransfer(m) },
        { label: t('social.group.removeMember', 'Remove from group'), destructive: true, onPress: () => confirmRemove(m) },
      ],
      t('common.cancel', 'Cancel'),
      m.uniqueId
    );

  const confirmRemove = (m: GroupMember) =>
    Alert.alert(t('social.group.removeTitle', { name: m.username, defaultValue: 'Remove {{name}}?' }), t('social.group.removeMessage', 'They lose access to this group. Their share of past bills stays.'), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      { text: t('social.group.removeMember', 'Remove from group'), style: 'destructive', onPress: () => void guard(() => store().removeMember(gid, m.uniqueId), t('social.group.removed', { name: m.username, defaultValue: '{{name}} was removed.' })) },
    ]);

  const confirmTransfer = (m: GroupMember) =>
    Alert.alert(
      t('social.group.transferTitle', { name: m.username, defaultValue: 'Make {{name}} the owner?' }),
      t('social.group.transferMessage', 'They will be able to rename and delete the group and manage members. You stay in the group as a member. Pending invitations are cancelled.'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('social.group.transfer', 'Transfer ownership'), style: 'destructive', onPress: () => void guard(() => store().transferOwnership(gid, m.uniqueId), t('social.group.transferred', { name: m.username, defaultValue: '{{name}} is now the owner.' })) },
      ]
    );

  const pickNewOwner = () => {
    const candidates = members.filter((m) => m.role !== 'owner');
    if (candidates.length === 0) return Alert.alert(t('social.group.transfer', 'Transfer ownership'), t('social.group.transferNoMembers', 'There is nobody else in the group yet. Invite someone first.'));
    showSheet(t('social.group.transferPick', 'Choose the new owner'), candidates.slice(0, 8).map((m) => ({ label: `${m.username} ${m.uniqueId}`, onPress: () => confirmTransfer(m) })), t('common.cancel', 'Cancel'));
  };

  const confirmLeave = () =>
    Alert.alert(t('social.group.leaveTitle', { name, defaultValue: 'Leave “{{name}}”?' }), t('social.group.leaveMessage', 'You will no longer see this group. Your share of past bills stays.'), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      { text: t('social.group.leave', 'Leave group'), style: 'destructive', onPress: () => void guard(() => store().leaveGroup(gid), undefined, () => router.dismissTo('/tabs/groups' as never)) },
    ]);

  const saveName = async () => {
    const ok = await guard(() => store().renameGroup(gid, newName), t('social.group.renamed', 'Group renamed.'));
    if (ok) setRenaming(false);
  };

  const doDelete = () => void guard(() => store().deleteGroup(gid), undefined, () => router.dismissTo('/tabs/groups' as never));

  if (!ready) {
    return (
      <Screen keyboard={false}>
        {errorKey && !loading ? (
          <EmptyState title={t('social.loadError', "Couldn't load")} message={t(errorKey, 'Something went wrong')}>
            <Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void openGroup(gid)} />
          </EmptyState>
        ) : (
          <View style={{ gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}><Skeleton height={110} style={{ borderRadius: radius.card }} /><Skeleton height={64} /><Skeleton height={64} /></View>
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {notice && <Banner kind={notice.kind === 'error' ? 'error' : 'success'}>{notice.text}</Banner>}

      <FadeIn>
        <Card style={{ gap: space.md }}>
          {renaming ? (
            <>
              <Field label={t('social.create.name', 'Group name')} value={newName} onChangeText={setNewName} autoCapitalize="sentences" maxLength={60} autoFocus returnKeyType="done" onSubmitEditing={() => void saveName()} />
              <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' }}>
                <PillButton kind="secondary" title={t('common.cancel', 'Cancel')} onPress={() => setRenaming(false)} />
                <PillButton title={t('social.group.save', 'Save')} loading={busy} disabled={newName.trim().length === 0} onPress={() => void saveName()} />
              </View>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 24, fontWeight: '800' }}>{name}</Text>
              <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15 }}>
                {t('social.group.memberCount', { count: members.length, defaultValue: '{{count}} members' })} · {role === 'owner' ? t('social.group.youOwner', 'You are the owner') : t('social.group.youMember', 'You are a member')}
              </Text>
              {perms.canRename && <View style={{ alignSelf: 'flex-start' }}><PillButton kind="secondary" title={t('social.group.rename', 'Rename')} onPress={() => { setNewName(name); setRenaming(true); }} /></View>}
            </>
          )}
        </Card>
      </FadeIn>

      <Section
        title={t('social.group.people', 'People')}
        footer={!perms.canInvite ? t('social.group.ownerOnlyInvite', 'Only the owner can invite people.') : t('social.group.inviteFooter', 'Invited people join only if they accept.')}
      >
        <Row icon={<UserPlus size={22} color={c.accentText} />} label={t('social.group.invitePeople', 'Invite people')} subtitle={t('social.group.invitePeopleHint', 'Add friends or invite anyone by username or ID')} onPress={goInvite} disabled={!perms.canInvite || !online} />
        <Row icon={<Link2 size={22} color={c.accentText} />} label={t('social.group.inviteLink', 'Invite by link or QR')} onPress={goLink} disabled={!perms.canCreateLink || !online} />
      </Section>

      <View style={{ gap: space.sm }}>
        <SectionTitle>{t('social.group.membersTitle', { count: members.length, defaultValue: 'Members ({{count}})' })}</SectionTitle>
        <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          {members.map((m, i) => {
            const isMe = m.uniqueId === me?.uniqueId;
            const manageable = perms.canRemoveMembers && m.role !== 'owner' && !isMe;
            return (
              <View key={m.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                <UserRow
                  user={m}
                  subtitle={m.role === 'owner' ? t('social.group.owner', 'Owner') : isMe ? t('social.group.you', 'You') : undefined}
                  right={manageable ? <IconBtn label={t('social.group.memberActions', { name: m.username, defaultValue: 'Actions for {{name}}' })} onPress={() => memberMenu(m)} disabled={!online}><MoreHorizontal size={20} color={c.text} /></IconBtn> : undefined}
                />
              </View>
            );
          })}
        </View>
      </View>

      {perms.canSeePending && sent.length > 0 && (
        <View style={{ gap: space.sm }}>
          <SectionTitle>{t('social.group.pending', 'Waiting for an answer')}</SectionTitle>
          <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
            {sent.map((s, i) => (
              <View key={s.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                <UserRow user={s.invitee} right={<PillButton kind="secondary" title={t('social.action.cancelInvite', 'Cancel invitation')} a11yLabel={t('social.group.cancelInviteA11y', { name: s.invitee.username, defaultValue: 'Cancel invitation for {{name}}' })} disabled={busy || !online} onPress={() => void guard(() => store().cancelInvitation(gid, s.id), t('social.group.inviteCancelled', 'Invitation cancelled.'))} />} />
              </View>
            ))}
          </View>
        </View>
      )}

      <Section title={t('social.group.dangerZone', 'Danger zone')} footer={role === 'owner' ? t('social.group.deleteFooter', 'Deleting a group keeps all bills and history; they are only detached from the group.') : undefined}>
        <Row
          label={t('social.group.leave', 'Leave group')}
          subtitle={!perms.canLeave ? t(deniedReasonKey(role, 'leave'), 'Transfer ownership first.') : undefined}
          destructive
          disabled={!perms.canLeave || !online}
          onPress={confirmLeave}
        />
        <Row label={t('social.group.transfer', 'Transfer ownership')} subtitle={!perms.canTransfer ? t('social.group.ownerOnly', 'Only the owner can do this.') : undefined} destructive disabled={!perms.canTransfer || !online} onPress={pickNewOwner} />
        <Row label={t('social.group.delete', 'Delete group')} subtitle={!perms.canDelete ? t('social.group.ownerOnly', 'Only the owner can do this.') : undefined} destructive disabled={!perms.canDelete || !online} onPress={() => { setDeleting(true); setTyped(''); }} />
      </Section>

      {perms.canDelete && deleting && (
        <Card style={{ gap: space.md, borderColor: c.danger }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.danger, fontSize: 17, fontWeight: '800' }}>{t('social.group.deleteTitle', 'Delete this group?')}</Text>
          <Text maxFontSizeMultiplier={1.5} style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{t('social.group.deleteMessage', { name, defaultValue: 'All members lose the group and pending invitations are cancelled. Bills and history are kept. This cannot be undone. Type “{{name}}” to confirm.' })}</Text>
          <Field label={t('social.group.deleteType', 'Group name')} value={typed} onChangeText={setTyped} placeholder={name} autoCapitalize="none" />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button variant="secondary" title={t('common.cancel', 'Cancel')} onPress={() => setDeleting(false)} /></View>
            <View style={{ flex: 1 }}><Button variant="danger" title={t('social.group.deleteConfirm', 'Delete')} loading={busy} disabled={!deleteConfirmed(typed, name)} onPress={doDelete} /></View>
          </View>
        </Card>
      )}
    </Screen>
  );
}
