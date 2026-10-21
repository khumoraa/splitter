/** What a person's row offers, derived from the relation to the current user. Pure. */
export type Relation = 'none' | 'friend' | 'request_sent' | 'request_received';
export type GroupStatus = 'none' | 'member' | 'invited';

export type FriendActionKind = 'add' | 'cancel' | 'accept' | 'friends';
export interface RowAction { kind: string; labelKey: string; enabled: boolean }

export function friendAction(relation: Relation): RowAction & { kind: FriendActionKind } {
  switch (relation) {
    case 'friend': return { kind: 'friends', labelKey: 'social.action.friends', enabled: false };
    case 'request_sent': return { kind: 'cancel', labelKey: 'social.action.cancelRequest', enabled: true };
    case 'request_received': return { kind: 'accept', labelKey: 'social.action.accept', enabled: true };
    default: return { kind: 'add', labelKey: 'social.action.add', enabled: true };
  }
}

export type InviteActionKind = 'invite' | 'cancel' | 'member';

export function inviteAction(status: GroupStatus): RowAction & { kind: InviteActionKind } {
  switch (status) {
    case 'member': return { kind: 'member', labelKey: 'social.action.alreadyInGroup', enabled: false };
    case 'invited': return { kind: 'cancel', labelKey: 'social.action.cancelInvite', enabled: true };
    default: return { kind: 'invite', labelKey: 'social.action.invite', enabled: true };
  }
}
