import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import { PROFILE_SELECT } from "../config/userSelect.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { releaseAvatar } from "../storage/releaseAvatar.js";
import { deleteAccount } from "../services/accountDeletion.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Users and the current user's account
 */

/**
 * @swagger
 * /users/me/export:
 *   get:
 *     summary: Download my own data (profile, friends, groups, bills) as JSON
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get("/me/export", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { ...PROFILE_SELECT, createdAt: true } });
    if (!me) return res.status(404).json({ error: "User not found" });

    const [friendships, memberships, owned, history] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: me.id }, { receiverId: me.id }] },
        select: {
          status: true,
          createdAt: true,
          requester: { select: { uniqueId: true, username: true } },
          receiver: { select: { uniqueId: true, username: true } },
        },
      }),
      prisma.groupMember.findMany({ where: { userId: me.id }, select: { role: true, joinedAt: true, group: { select: { id: true, name: true } } } }),
      prisma.group.findMany({ where: { ownerId: me.id }, select: { id: true, name: true, createdAt: true } }),
      prisma.sessionHistoryEntry.findMany({
        where: { OR: [{ creatorId: me.id }, { participantUniqueIds: { has: me.uniqueId } }] },
        orderBy: { finalizedAt: "desc" },
        select: { sessionId: true, sessionName: true, grandTotal: true, currency: true, finalizedAt: true, payload: true },
      }),
    ]);

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      exportedAt: new Date().toISOString(),
      profile: me,
      friends: friendships.map((f) => ({
        status: f.status,
        since: f.createdAt,
        with: f.requester.uniqueId === me.uniqueId ? f.receiver : f.requester,
      })),
      groups: [
        ...owned.map((g) => ({ ...g, role: "owner" })),
        ...memberships.filter((m) => !owned.some((g) => g.id === m.group.id)).map((m) => ({ id: m.group.id, name: m.group.name, role: m.role.toLowerCase(), joinedAt: m.joinedAt })),
      ],
      bills: history.map((h) => ({ ...h, grandTotal: Number(h.grandTotal) })),
    });
  } catch (err) {
    console.error("GET /users/me/export error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /users/me/avatar:
 *   delete:
 *     summary: Remove my avatar (avatarUrl becomes null) and delete the file
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ success, avatarUrl: null, user }"
 */
router.delete("/me/avatar", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const before = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarUrl: true } });
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null }, select: PROFILE_SELECT });
    void releaseAvatar(before?.avatarUrl);
    return res.json({ success: true, avatarUrl: null, user });
  } catch (err) {
    console.error("DELETE /users/me/avatar error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /users/me:
 *   delete:
 *     summary: Delete my account (requires my password)
 *     description: |
 *       Body { password }. Friendships are removed; groups I own go to another member (or are deleted if I am alone in
 *       them); bills I created that other people share stay for them with my name and id removed; all my tokens stop working.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ success: true }" }
 *       400: { description: Password missing or wrong }
 *       429: { description: Too many attempts }
 */
router.delete(
  "/me",
  authenticateToken,
  rateLimit({ windowMs: 15 * 60_000, max: 5, name: "account-delete" }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const password = req.body?.password;
      if (typeof password !== "string" || !password) {
        return res.status(400).json({ error: "Password is required" });
      }
      const result = await deleteAccount(req.user.id, password);
      if (!result.ok) {
        return result.reason === "not_found"
          ? res.status(404).json({ error: "User not found" })
          : res.status(400).json({ error: "Password is incorrect" });
      }
      console.log("account deleted:", { id: req.user.id });
      return res.json({ success: true });
    } catch (err) {
      console.error("DELETE /users/me error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get a user's public profile (email only for myself)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get("/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const user = await prisma.user.findUnique({ where: { id }, select: PROFILE_SELECT });
    if (!user) return res.status(404).json({ error: "User not found" });
    // other people's email addresses are private
    const { email, ...publicProfile } = user;
    return res.json(req.user?.id === user.id ? user : publicProfile);
  } catch (err) {
    console.error("GET /users/:id error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
