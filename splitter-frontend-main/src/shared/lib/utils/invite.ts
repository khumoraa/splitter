export type InviteKind = 'friend' | 'group' | 'friend-id';

/** "#1234": the short id every user has (4 digits). */
const UNIQUE_ID_RE = /^#\d{4}$/;
const FRIEND_ID_RE = /^receipt-splitter:\/\/friend\?(?:[^#]*&)?uid=([^&#]+)/;

/** The text encoded in "my QR": scanning it in Splitter sends a friend request to that id. */
export function buildFriendIdLink(uniqueId: string): string {
  return `receipt-splitter://friend?uid=${encodeURIComponent(uniqueId)}`;
}

export function parseInviteFromScan(raw: string): { kind: InviteKind; token: string } | null {
  try {
    const m = FRIEND_ID_RE.exec(raw);
    if (m) {
      const uid = decodeURIComponent(m[1]!);
      return UNIQUE_ID_RE.test(uid) ? { kind: 'friend-id', token: uid } : null;
    }
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) return null;
    const u = new URL(raw);
    const token = u.searchParams.get('token');
    if (!token) return null;

    const path = u.pathname;
    if (path.startsWith('/friends/join')) return { kind: 'friend', token };
    if (path.startsWith('/groups/join')) return { kind: 'group', token };
    return null;
  } catch {
    return null;
  }
}
