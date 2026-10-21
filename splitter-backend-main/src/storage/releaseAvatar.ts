import { prisma } from "../config/prisma.js";
import { deleteAnyStoredAvatar } from "./avatarStorage.js";

/**
 * Deletes the file behind an avatar value that a user no longer uses, but only when nobody else still points at it
 * (so one user can never remove another user's picture). Best effort: failures are logged, not thrown.
 */
export async function releaseAvatar(stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  try {
    const stillUsed = await prisma.user.count({ where: { avatarUrl: stored } });
    if (stillUsed === 0) await deleteAnyStoredAvatar(stored);
  } catch (err) {
    console.warn("releaseAvatar failed:", err instanceof Error ? err.message : err);
  }
}
