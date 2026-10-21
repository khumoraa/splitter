/** Filtering and A–Z sectioning of the friends list. Pure. */
export interface FriendLike { id: number; username: string; uniqueId: string }

const norm = (s: string) => s.normalize('NFC').toLowerCase();

export function filterFriends<T extends FriendLike>(friends: T[], query: string): T[] {
  const q = norm(query.trim().replace(/^[@#]/u, ''));
  if (!q) return friends;
  return friends.filter((f) => norm(f.username).includes(q) || norm(f.uniqueId).includes(q));
}

export interface Section<T> { title: string; data: T[] }

export function sectionizeFriends<T extends FriendLike>(friends: T[]): Section<T>[] {
  const sorted = [...friends].sort((a, b) => {
    const x = norm(a.username), y = norm(b.username);
    return x < y ? -1 : x > y ? 1 : a.id - b.id;
  });
  const map = new Map<string, T[]>();
  for (const f of sorted) {
    const first = Array.from(f.username.trim())[0] ?? '#';
    const key = /\p{L}/u.test(first) ? first.toLocaleUpperCase() : '#';
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  // '#' (digits, symbols) last, the rest in order of first appearance, which is already alphabetical
  const keys = [...map.keys()].filter((k) => k !== '#');
  if (map.has('#')) keys.push('#');
  return keys.map((title) => ({ title, data: map.get(title)! }));
}
