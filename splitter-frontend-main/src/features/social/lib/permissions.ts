/** What each role may do in a group. The server enforces the same rules; the UI only hides or disables. Pure. */
export type GroupRole = 'owner' | 'member';

export interface GroupPermissions {
  canRename: boolean;
  canInvite: boolean;
  canCreateLink: boolean;
  canAddFriends: boolean;
  canRemoveMembers: boolean;
  canSeePending: boolean;
  canTransfer: boolean;
  canDelete: boolean;
  canLeave: boolean;
}

export function groupPermissions(role: GroupRole | null | undefined): GroupPermissions {
  const owner = role === 'owner';
  const member = role === 'member';
  return {
    canRename: owner, canInvite: owner, canCreateLink: owner, canAddFriends: owner, canRemoveMembers: owner,
    canSeePending: owner, canTransfer: owner, canDelete: owner,
    canLeave: member, // the owner must hand over the group first
  };
}

/** Why a disabled action is disabled, as an i18n key. */
export function deniedReasonKey(role: GroupRole | null | undefined, action: 'leave' | 'manage'): string {
  if (action === 'leave' && role === 'owner') return 'social.group.ownerCannotLeave';
  return 'social.group.ownerOnly';
}

/** Typing the exact group name is the second confirmation for deleting it (trimmed, case-sensitive on purpose). */
export function deleteConfirmed(typed: string, groupName: string): boolean {
  return typed.trim() === groupName.trim() && groupName.trim() !== '';
}
