import { prisma } from "../config/prisma.js";
import { PUBLIC_USER_SELECT } from "../config/userSelect.js";
import { TOMBSTONE_EMAIL } from "./accountDeletion.js";
import { rankCandidates } from "../utils/searchQuery.js";
import type { ParsedQuery } from "../utils/searchQuery.js";
import { relationOf } from "../utils/friendship.js";
import type { Relation, Row } from "../utils/friendship.js";

export type GroupStatus = "none" | "member" | "invited";

export interface SearchHit {
  id: number;
  username: string;
  uniqueId: string;
  avatarUrl: string | null;
  relation: Relation;
  groupStatus?: GroupStatus;
}

const CANDIDATE_CAP = 300;

/** Finds users for a parsed query, ranked, then decorates the requested page with the relation to `me` (and to a group). */
export async function searchUsers(args: { me: number; parsed: ParsedQuery; limit: number; offset: number; groupId?: number }): Promise<{ results: SearchHit[]; nextOffset: number | null }> {
  const { me, parsed, limit, offset, groupId } = args;
  const base = { id: { not: me }, email: { not: TOMBSTONE_EMAIL } };

  type U = { id: number; username: string; uniqueId: string; avatarUrl: string | null };
  const found: U[] = [];
  const seen = new Set<number>();
  const push = (u: U) => { if (!seen.has(u.id)) { seen.add(u.id); found.push(u); } };

  if (parsed.kind === "id" || (parsed.kind === "name" && parsed.alsoId)) {
    const uniqueId = parsed.kind === "id" ? parsed.uniqueId : parsed.alsoId!;
    const byId = await prisma.user.findFirst({ where: { ...base, uniqueId }, select: PUBLIC_USER_SELECT });
    if (byId) {
      // "name#1234": the name must also fit, so an ID alone does not confirm a different person
      const ok = parsed.kind === "id" && parsed.namePart ? rankCandidates([byId], parsed.namePart).length > 0 : true;
      if (ok) push(byId);
    }
  }
  if (parsed.kind === "name") {
    const rows = await prisma.user.findMany({
      where: { ...base, username: { contains: parsed.text, mode: "insensitive" } },
      select: PUBLIC_USER_SELECT,
      orderBy: { id: "asc" },
      take: CANDIDATE_CAP,
    });
    for (const u of rankCandidates(rows, parsed.text)) push(u);
  }

  const page = found.slice(offset, offset + limit);
  const nextOffset = offset + limit < found.length ? offset + limit : null;
  if (page.length === 0) return { results: [], nextOffset };

  const ids = page.map((u) => u.id);
  const friendRows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: me, receiverId: { in: ids } }, { receiverId: me, requesterId: { in: ids } }] },
    select: { id: true, requesterId: true, receiverId: true, status: true, updatedAt: true },
  });
  const now = Date.now();
  const byOther = new Map<number, Row[]>();
  for (const r of friendRows) {
    const other = r.requesterId === me ? r.receiverId : r.requesterId;
    const list = byOther.get(other) ?? [];
    list.push({ id: r.id, requesterId: r.requesterId, receiverId: r.receiverId, status: r.status, updatedAt: r.updatedAt.getTime() });
    byOther.set(other, list);
  }

  let memberIds = new Set<number>();
  let invitedIds = new Set<number>();
  if (groupId !== undefined) {
    const [group, members, invites] = await Promise.all([
      prisma.group.findUnique({ where: { id: groupId }, select: { ownerId: true } }),
      prisma.groupMember.findMany({ where: { groupId, userId: { in: ids } }, select: { userId: true } }),
      prisma.groupInvitation.findMany({ where: { groupId, status: "PENDING", inviteeId: { in: ids } }, select: { inviteeId: true } }),
    ]);
    memberIds = new Set(members.map((m) => m.userId));
    if (group) memberIds.add(group.ownerId);
    invitedIds = new Set(invites.map((i) => i.inviteeId));
  }

  const results: SearchHit[] = page.map((u) => ({
    id: u.id,
    username: u.username,
    uniqueId: u.uniqueId,
    avatarUrl: u.avatarUrl ?? null,
    relation: relationOf(byOther.get(u.id) ?? [], me, now),
    ...(groupId !== undefined ? { groupStatus: (memberIds.has(u.id) ? "member" : invitedIds.has(u.id) ? "invited" : "none") as GroupStatus } : {}),
  }));
  return { results, nextOffset };
}
