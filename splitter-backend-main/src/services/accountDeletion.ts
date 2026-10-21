import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { anonymizePayload, replaceUniqueId } from "../utils/anonymize.js";
import { releaseAvatar } from "../storage/releaseAvatar.js";

export const DELETED_USER_LABEL = "Deleted user";
const TOMBSTONE_EMAIL = "deleted-user@splitter.invalid";

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "wrong_password" };

/** The system account that keeps other people's history readable after the creator is gone. It cannot sign in. */
async function tombstoneUserId(): Promise<number> {
  const existing = await prisma.user.findUnique({ where: { email: TOMBSTONE_EMAIL }, select: { id: true } });
  if (existing) return existing.id;
  const password = await bcrypt.hash(randomBytes(32).toString("hex"), 10); // nobody knows it
  for (let i = 0; i < 20; i++) {
    const uniqueId = `#d${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      const u = await prisma.user.create({ data: { email: TOMBSTONE_EMAIL, password, username: DELETED_USER_LABEL, uniqueId }, select: { id: true } });
      return u.id;
    } catch (e: any) {
      if (e?.code === "P2002") {
        const again = await prisma.user.findUnique({ where: { email: TOMBSTONE_EMAIL }, select: { id: true } });
        if (again) return again.id; // created concurrently
        continue; // uniqueId collision
      }
      throw e;
    }
  }
  throw new Error("could not create the placeholder user");
}

/**
 * Deletes an account after checking the password. Everything happens in one transaction:
 *  - friendships (both directions) are removed;
 *  - owned groups go to the longest-standing other member, or are deleted when the user is alone in them;
 *  - memberships, item assignments and session participations are removed;
 *  - sessions created by the user are deleted when nobody else is in their history; otherwise they stay for the other
 *    participants and are re-assigned to the placeholder account, with the user's id/name removed from the history JSON;
 *  - the user row is deleted. The avatar file is removed after the transaction commits.
 */
export async function deleteAccount(userId: number, password: string): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, reason: "not_found" };
  if (!(await bcrypt.compare(password, user.password))) return { ok: false, reason: "wrong_password" };

  const tombstoneId = await tombstoneUserId();
  const anonUid = `#deleted-${randomBytes(6).toString("hex")}`;

  await prisma.$transaction(
    async (tx) => {
      await tx.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { receiverId: userId }] } });

      // groups the user owns
      const owned = await tx.group.findMany({ where: { ownerId: userId }, select: { id: true } });
      for (const g of owned) {
        const next = await tx.groupMember.findFirst({
          where: { groupId: g.id, userId: { not: userId } },
          orderBy: { joinedAt: "asc" },
          select: { userId: true },
        });
        if (next) {
          await tx.group.update({ where: { id: g.id }, data: { ownerId: next.userId } });
        } else {
          await tx.session.updateMany({ where: { groupId: g.id }, data: { groupId: null } });
          await tx.groupMember.deleteMany({ where: { groupId: g.id } });
          await tx.group.delete({ where: { id: g.id } });
        }
      }
      await tx.groupMember.deleteMany({ where: { userId } });
      await tx.itemAssignment.deleteMany({ where: { userId } });
      await tx.sessionParticipant.deleteMany({ where: { userId } });

      // sessions created by the user
      const sessions = await tx.session.findMany({ where: { creatorId: userId }, select: { id: true } });
      for (const s of sessions) {
        const entry = await tx.sessionHistoryEntry.findUnique({ where: { sessionId: s.id } });
        const others = (entry?.participantUniqueIds ?? []).filter((id) => id !== user.uniqueId);
        if (entry && others.length > 0) {
          await tx.sessionHistoryEntry.update({
            where: { sessionId: s.id },
            data: {
              creatorId: tombstoneId,
              participantUniqueIds: replaceUniqueId(entry.participantUniqueIds, user.uniqueId, anonUid),
              payload: anonymizePayload(entry.payload as any, user.uniqueId, anonUid, DELETED_USER_LABEL),
            },
          });
          await tx.session.update({ where: { id: s.id }, data: { creatorId: tombstoneId } });
        } else {
          await tx.itemAssignment.deleteMany({ where: { item: { sessionId: s.id } } });
          await tx.receiptItem.deleteMany({ where: { sessionId: s.id } });
          await tx.sessionParticipant.deleteMany({ where: { sessionId: s.id } });
          await tx.sessionHistoryEntry.deleteMany({ where: { sessionId: s.id } });
          await tx.session.delete({ where: { id: s.id } });
        }
      }

      // history the user only took part in (created by someone else): remove their identity from it
      const asParticipant = await tx.sessionHistoryEntry.findMany({ where: { participantUniqueIds: { has: user.uniqueId } } });
      for (const e of asParticipant) {
        await tx.sessionHistoryEntry.update({
          where: { id: e.id },
          data: {
            participantUniqueIds: replaceUniqueId(e.participantUniqueIds, user.uniqueId, anonUid),
            payload: anonymizePayload(e.payload as any, user.uniqueId, anonUid, DELETED_USER_LABEL),
          },
        });
      }

      await tx.user.delete({ where: { id: userId } });
    },
    { timeout: 20_000 }
  );

  void releaseAvatar(user.avatarUrl);
  return { ok: true };
}
