import { Router } from "express";
import { isDbId } from "../utils/dbId.js";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { PUBLIC_USER_SELECT } from "../config/userSelect.js";
import { TOMBSTONE_EMAIL } from "../services/accountDeletion.js";
import { fail, serverError } from "../utils/apiError.js";
import {
  MAX_GROUP_MEMBERS, MAX_INVITES_PER_DAY, MAX_PENDING_PER_GROUP, normalizeGroupName, readUniqueIds,
} from "../utils/groupInput.js";

const router = Router();

const getInviteSecret = () => process.env.GROUP_INVITE_SECRET || process.env.JWT_SECRET || "";
const groupId = (req: AuthRequest) => Number(req.params.groupId);
const validId = isDbId;
type PublicUser = { id: number; username: string; uniqueId: string; avatarUrl: string | null };
const pub = (u: PublicUser) => ({ id: u.id, uniqueId: u.uniqueId, username: u.username, avatarUrl: u.avatarUrl ?? null });

/** Number of people in a group: the owner plus the member rows that are not the owner. */
async function memberCount(gid: number, ownerId: number): Promise<number> {
  return 1 + (await prisma.groupMember.count({ where: { groupId: gid, userId: { not: ownerId } } }));
}

async function areFriends(a: number, b: number): Promise<boolean> {
  const f = await prisma.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: a, receiverId: b }, { requesterId: b, receiverId: a }] },
    select: { id: true },
  });
  return !!f;
}

/** Group + the caller's standing, or an error code. */
async function loadForOwner(req: AuthRequest, res: Response): Promise<{ id: number; name: string; ownerId: number } | null> {
  if (!req.user) { fail(res, "UNAUTHORIZED"); return null; }
  const gid = groupId(req);
  if (!validId(gid)) { fail(res, "VALIDATION", { field: "groupId" }); return null; }
  const g = await prisma.group.findUnique({ where: { id: gid }, select: { id: true, name: true, ownerId: true } });
  if (!g) { fail(res, "NOT_FOUND"); return null; }
  if (g.ownerId !== req.user.id) { fail(res, "FORBIDDEN"); return null; }
  return g;
}

/**
 * @swagger
 * tags:
 *   name: Groups
 *   description: Groups, members, invite links and invitations
 */

/**
 * @swagger
 * /groups:
 *   post:
 *     summary: Create a group (name 1-60 characters)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const name = normalizeGroupName(req.body?.name);
    if (!name) return fail(res, "VALIDATION", { field: "name" });
    const group = await prisma.group.create({ data: { name, ownerId: req.user.id } });
    return res.json(group);
  } catch (err) {
    console.error("POST /groups error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups:
 *   get:
 *     summary: My groups with members, counts and the latest bill
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const me = req.user.id;
    const groups = await prisma.group.findMany({
      where: { OR: [{ ownerId: me }, { members: { some: { userId: me } } }] },
      select: {
        id: true, name: true, ownerId: true, createdAt: true,
        _count: { select: { sessions: true } },
        owner: { select: PUBLIC_USER_SELECT },
        members: { orderBy: { joinedAt: "asc" }, select: { userId: true, user: { select: PUBLIC_USER_SELECT } } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
      },
      orderBy: { id: "asc" },
    });
    return res.json(
      groups.map((g) => {
        const others = g.members.filter((m) => m.userId !== g.ownerId).map((m) => ({ ...pub(m.user), role: "member" as const }));
        return {
          id: g.id,
          name: g.name,
          ownerId: g.ownerId,
          createdAt: g.createdAt,
          myRole: g.ownerId === me ? ("owner" as const) : ("member" as const),
          counts: { members: others.length + 1, sessions: g._count.sessions },
          lastSession: g.sessions[0] ? { id: g.sessions[0].id, createdAt: g.sessions[0].createdAt } : null,
          members: [{ ...pub(g.owner), role: "owner" as const }, ...others],
        };
      })
    );
  } catch (err) {
    console.error("GET /groups error:", err);
    return serverError(res);
  }
});

// ---------------------------------------------------------------- invitations of the current user (must precede /:groupId)

const invitationOut = (i: { id: number; createdAt: Date; group: { id: number; name: string }; inviter: PublicUser }) => ({
  id: i.id,
  createdAt: i.createdAt,
  // before accepting, the invitee sees only the group's name and who invited them
  group: { id: i.group.id, name: i.group.name },
  inviter: pub(i.inviter),
});

/**
 * @swagger
 * /groups/invitations:
 *   get:
 *     summary: Pending invitations addressed to me (group name and inviter only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.get("/invitations", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const rows = await prisma.groupInvitation.findMany({
      where: { inviteeId: req.user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, group: { select: { id: true, name: true } }, inviter: { select: PUBLIC_USER_SELECT } },
    });
    return res.json(rows.map(invitationOut));
  } catch (err) {
    console.error("GET /groups/invitations error:", err);
    return serverError(res);
  }
});

const answerInvitation = (accept: boolean) => async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const id = Number(req.params.id);
    if (!validId(id)) return fail(res, "VALIDATION", { field: "id" });
    const me = req.user.id;
    const inv = await prisma.groupInvitation.findFirst({ where: { id, inviteeId: me }, select: { id: true, groupId: true, status: true } });
    if (!inv) return fail(res, "NOT_FOUND");
    if (inv.status !== "PENDING") return fail(res, "INVITATION_NOT_PENDING");

    if (!accept) {
      const r = await prisma.groupInvitation.updateMany({ where: { id, status: "PENDING" }, data: { status: "DECLINED", respondedAt: new Date() } });
      return r.count ? res.json({ success: true, status: "DECLINED" }) : fail(res, "INVITATION_NOT_PENDING");
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const claimed = await tx.groupInvitation.updateMany({ where: { id, status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      if (claimed.count === 0) return "NOT_PENDING" as const;
      const g = await tx.group.findUnique({ where: { id: inv.groupId }, select: { ownerId: true } });
      if (!g) return "GONE" as const;
      const already = g.ownerId === me || !!(await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: inv.groupId, userId: me } } }));
      if (already) return "ALREADY" as const;
      const size = 1 + (await tx.groupMember.count({ where: { groupId: inv.groupId, userId: { not: g.ownerId } } }));
      if (size >= MAX_GROUP_MEMBERS) throw new Error("GROUP_FULL");
      await tx.groupMember.create({ data: { groupId: inv.groupId, userId: me, role: "MEMBER" } });
      return "JOINED" as const;
    }).catch((e: unknown) => (e instanceof Error && e.message === "GROUP_FULL" ? ("FULL" as const) : Promise.reject(e)));

    if (outcome === "NOT_PENDING") return fail(res, "INVITATION_NOT_PENDING");
    if (outcome === "GONE") return fail(res, "NOT_FOUND");
    if (outcome === "FULL") return fail(res, "GROUP_FULL");
    return res.json({ success: true, status: "ACCEPTED", groupId: inv.groupId, alreadyMember: outcome === "ALREADY" });
  } catch (err) {
    console.error("PATCH /groups/invitations/:id error:", err);
    return serverError(res);
  }
};

/**
 * @swagger
 * /groups/invitations/{id}/accept:
 *   patch:
 *     summary: Accept an invitation (creates the membership in a transaction; does not create a friendship)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 * /groups/invitations/{id}/decline:
 *   patch:
 *     summary: Decline an invitation
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.patch("/invitations/:id/accept", authenticateToken, answerInvitation(true));
router.patch("/invitations/:id/decline", authenticateToken, answerInvitation(false));

// ---------------------------------------------------------------- group details

/**
 * @swagger
 * /groups/{groupId}:
 *   get:
 *     summary: Group details for a member (403 for everyone else)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.get("/:groupId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const gid = groupId(req);
    if (!validId(gid)) return fail(res, "VALIDATION", { field: "groupId" });
    const group = await prisma.group.findUnique({
      where: { id: gid },
      select: {
        id: true, name: true, ownerId: true, createdAt: true,
        owner: { select: PUBLIC_USER_SELECT },
        members: { orderBy: { joinedAt: "asc" }, select: { userId: true, user: { select: PUBLIC_USER_SELECT } } },
      },
    });
    if (!group) return fail(res, "NOT_FOUND");
    const me = req.user.id;
    const isOwner = group.ownerId === me;
    if (!isOwner && !group.members.some((m) => m.userId === me)) return fail(res, "FORBIDDEN");
    const others = group.members.filter((m) => m.userId !== group.ownerId).map((m) => ({ ...pub(m.user), role: "member" as const }));
    return res.json({
      group: { id: group.id, name: group.name, ownerId: group.ownerId, createdAt: group.createdAt },
      role: isOwner ? "owner" : "member",
      members: [{ ...pub(group.owner), role: "owner" as const }, ...others],
    });
  } catch (err) {
    console.error("GET /groups/:groupId error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups/{groupId}:
 *   patch:
 *     summary: Rename (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     summary: Delete the group (owner only). Bills and history are kept; they are only detached from the group
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.patch("/:groupId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const name = normalizeGroupName(req.body?.name);
    if (!name) return fail(res, "VALIDATION", { field: "name" });
    return res.json(await prisma.group.update({ where: { id: g.id }, data: { name } }));
  } catch (err) {
    console.error("PATCH /groups/:groupId error:", err);
    return serverError(res);
  }
});

router.delete("/:groupId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    await prisma.$transaction([
      prisma.groupInvitation.deleteMany({ where: { groupId: g.id } }),
      prisma.groupMember.deleteMany({ where: { groupId: g.id } }),
      prisma.group.delete({ where: { id: g.id } }), // Session.groupId becomes NULL: the bills stay
    ]);
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /groups/:groupId error:", err);
    return serverError(res);
  }
});

// ---------------------------------------------------------------- invite link

/**
 * @swagger
 * /groups/{groupId}/invite:
 *   post:
 *     summary: Create an invite link (owner only; JWT 1-60 min, reusable until it expires)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.post("/:groupId/invite", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const secret = getInviteSecret();
    if (!secret) return serverError(res);
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.max(60, Math.min(3600, Number(req.body?.expiresInSeconds) || 900));
    const exp = nowSec + ttl;
    const token = jwt.sign({ typ: "group_invite" as const, gid: g.id, oid: g.ownerId, iat: nowSec, exp }, secret);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    return res.json({ token, url: `${baseUrl}/groups/join?token=${encodeURIComponent(token)}`, expiresAt: new Date(exp * 1000).toISOString() });
  } catch (err) {
    console.error("POST /groups/:groupId/invite error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups/join:
 *   post:
 *     summary: Join by invite token (errors TOKEN_EXPIRED, TOKEN_INVALID, ALREADY_MEMBER, GROUP_FULL). Also makes the user a friend of the owner, as before
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.post("/join", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return fail(res, "VALIDATION", { field: "token" });
    const secret = getInviteSecret();
    if (!secret) return serverError(res);
    let decoded: any;
    try {
      decoded = jwt.verify(token, secret);
    } catch (e) {
      return fail(res, e instanceof jwt.TokenExpiredError ? "TOKEN_EXPIRED" : "TOKEN_INVALID");
    }
    if (!decoded || decoded.typ !== "group_invite" || !Number.isInteger(decoded.gid) || !Number.isInteger(decoded.oid)) return fail(res, "TOKEN_INVALID");

    const gid = Number(decoded.gid);
    const ownerId = Number(decoded.oid);
    const group = await prisma.group.findUnique({ where: { id: gid }, select: { ownerId: true } });
    if (!group) return fail(res, "NOT_FOUND");
    if (group.ownerId !== ownerId) return fail(res, "TOKEN_INVALID"); // ownership changed: old links die
    const userId = req.user.id;
    if (userId === ownerId) return fail(res, "ALREADY_MEMBER");

    const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: gid, userId } } });
    if (member) return fail(res, "ALREADY_MEMBER");
    if ((await memberCount(gid, ownerId)) >= MAX_GROUP_MEMBERS) return fail(res, "GROUP_FULL");

    const existing = await prisma.friendship.findFirst({
      where: { OR: [{ requesterId: ownerId, receiverId: userId }, { requesterId: userId, receiverId: ownerId }] },
    });
    if (existing?.status === "BLOCKED") return fail(res, "REQUEST_NOT_ALLOWED");
    let friendship: "existing" | "accepted" | "created" = "existing";
    await prisma.$transaction(async (tx) => {
      if (existing) {
        if (existing.status !== "ACCEPTED") {
          await tx.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED" } });
          friendship = "accepted";
        }
      } else {
        await tx.friendship.create({ data: { requesterId: ownerId, receiverId: userId, status: "ACCEPTED" } });
        friendship = "created";
      }
      await tx.groupMember.create({ data: { groupId: gid, userId, role: "MEMBER" } });
      await tx.groupInvitation.updateMany({ where: { groupId: gid, inviteeId: userId, status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    });
    return res.json({ joined: true, friendship, member: "created", groupId: gid });
  } catch (err) {
    console.error("POST /groups/join error:", err);
    return serverError(res);
  }
});

// ---------------------------------------------------------------- invitations of a group (owner)

/**
 * @swagger
 * /groups/{groupId}/invitations:
 *   post:
 *     summary: Invite any registered user ({uniqueId} or {userId}); they must accept. Owner only
 *     description: Errors CANNOT_INVITE_SELF, ALREADY_MEMBER, INVITATION_EXISTS, INVITE_LIMIT (30 per day per owner, 20 pending per group), GROUP_FULL (50 members), NOT_FOUND, FORBIDDEN.
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *   get:
 *     summary: Pending invitations of the group (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.post("/:groupId/invitations", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const me = req.user!.id;
    const uid = typeof req.body?.uniqueId === "string" ? req.body.uniqueId.trim() : "";
    const userId = isDbId(req.body?.userId) ? Number(req.body.userId) : null;
    if (!uid && userId === null) return fail(res, "VALIDATION", { field: "uniqueId" });

    const target = await prisma.user.findFirst({
      where: { email: { not: TOMBSTONE_EMAIL }, ...(uid ? { uniqueId: uid } : { id: userId! }) },
      select: PUBLIC_USER_SELECT,
    });
    if (!target) return fail(res, "NOT_FOUND");
    if (target.id === me) return fail(res, "CANNOT_INVITE_SELF");

    const isMember = target.id === g.ownerId || !!(await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: target.id } } }));
    if (isMember) return fail(res, "ALREADY_MEMBER");
    const pending = await prisma.groupInvitation.findFirst({ where: { groupId: g.id, inviteeId: target.id, status: "PENDING" }, select: { id: true } });
    if (pending) return fail(res, "INVITATION_EXISTS");

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [sentToday, pendingInGroup, size] = await Promise.all([
      prisma.groupInvitation.count({ where: { inviterId: me, createdAt: { gt: dayAgo } } }),
      prisma.groupInvitation.count({ where: { groupId: g.id, status: "PENDING" } }),
      memberCount(g.id, g.ownerId),
    ]);
    if (sentToday >= MAX_INVITES_PER_DAY || pendingInGroup >= MAX_PENDING_PER_GROUP) return fail(res, "INVITE_LIMIT");
    if (size >= MAX_GROUP_MEMBERS) return fail(res, "GROUP_FULL");

    try {
      const inv = await prisma.groupInvitation.create({ data: { groupId: g.id, inviterId: me, inviteeId: target.id }, select: { id: true, status: true, createdAt: true } });
      return res.json({ success: true, invitation: { ...inv, invitee: pub(target) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(res, "INVITATION_EXISTS");
      throw e;
    }
  } catch (err) {
    console.error("POST /groups/:groupId/invitations error:", err);
    return serverError(res);
  }
});

router.get("/:groupId/invitations", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const rows = await prisma.groupInvitation.findMany({
      where: { groupId: g.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, invitee: { select: PUBLIC_USER_SELECT } },
    });
    return res.json(rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, invitee: pub(r.invitee) })));
  } catch (err) {
    console.error("GET /groups/:groupId/invitations error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups/{groupId}/invitations/{invId}:
 *   delete:
 *     summary: Cancel a pending invitation (owner only)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:groupId/invitations/:invId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const invId = Number(req.params.invId);
    if (!validId(invId)) return fail(res, "VALIDATION", { field: "invId" });
    const inv = await prisma.groupInvitation.findFirst({ where: { id: invId, groupId: g.id }, select: { status: true } });
    if (!inv) return fail(res, "NOT_FOUND");
    const r = await prisma.groupInvitation.updateMany({ where: { id: invId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
    return r.count ? res.json({ success: true, status: "CANCELLED" }) : fail(res, "INVITATION_NOT_PENDING");
  } catch (err) {
    console.error("DELETE /groups/:groupId/invitations/:invId error:", err);
    return serverError(res);
  }
});

// ---------------------------------------------------------------- members

/**
 * @swagger
 * /groups/{groupId}/members:
 *   post:
 *     summary: Add FRIENDS directly (a uniqueId or a list of up to 20 uniqueIds); other users must be invited. Owner only
 *     description: Returns success, the added uniqueIds and the skipped ones with a code.
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.post("/:groupId/members", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const ids = readUniqueIds(req.body);
    if (!ids) return fail(res, "VALIDATION", { field: "uniqueIds" });
    const me = req.user!.id;

    const added: string[] = [];
    const skipped: { uniqueId: string; code: string }[] = [];
    let size = await memberCount(g.id, g.ownerId);
    for (const uniqueId of ids) {
      const user = await prisma.user.findFirst({ where: { uniqueId, email: { not: TOMBSTONE_EMAIL } }, select: { id: true } });
      if (!user) { skipped.push({ uniqueId, code: "NOT_FOUND" }); continue; }
      if (user.id === me) { skipped.push({ uniqueId, code: "ALREADY_MEMBER" }); continue; }
      if (!(await areFriends(me, user.id))) { skipped.push({ uniqueId, code: "FRIENDSHIP_REQUIRED" }); continue; }
      if (size >= MAX_GROUP_MEMBERS) { skipped.push({ uniqueId, code: "GROUP_FULL" }); continue; }
      const created = await prisma.groupMember.create({ data: { groupId: g.id, userId: user.id, role: "MEMBER" } }).catch((e: any) => (e?.code === "P2002" ? null : Promise.reject(e)));
      if (!created) { skipped.push({ uniqueId, code: "ALREADY_MEMBER" }); continue; }
      await prisma.groupInvitation.updateMany({ where: { groupId: g.id, inviteeId: user.id, status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      size++;
      added.push(uniqueId);
    }
    // a single-user request keeps its old contract: the problem is the HTTP error
    if (ids.length === 1 && added.length === 0 && skipped[0]) return fail(res, skipped[0].code as never);
    return res.json({ success: true, added, skipped });
  } catch (err) {
    console.error("POST /groups/:groupId/members error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups/{groupId}/members/{uniqueId}:
 *   delete:
 *     summary: Remove a member (owner), or yourself (same as leave). The owner cannot be removed
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:groupId/members/:uniqueId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const gid = groupId(req);
    if (!validId(gid)) return fail(res, "VALIDATION", { field: "groupId" });
    const uniqueId = String(req.params.uniqueId || "").trim();
    if (!uniqueId) return fail(res, "VALIDATION", { field: "uniqueId" });
    const group = await prisma.group.findUnique({ where: { id: gid }, select: { ownerId: true } });
    if (!group) return fail(res, "NOT_FOUND");
    const user = await prisma.user.findUnique({ where: { uniqueId }, select: { id: true } });
    if (!user) return res.json({ success: true, removed: false });
    const isOwner = group.ownerId === req.user.id;
    if (!isOwner && user.id !== req.user.id) return fail(res, "FORBIDDEN");
    if (user.id === group.ownerId) return fail(res, "CANNOT_REMOVE_OWNER");
    const r = await prisma.groupMember.deleteMany({ where: { groupId: gid, userId: user.id } });
    return res.json({ success: true, removed: r.count > 0 });
  } catch (err) {
    console.error("DELETE /groups/:groupId/members/:uniqueId error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups/{groupId}/leave:
 *   post:
 *     summary: Leave the group (the owner must transfer ownership first, error OWNER_CANNOT_LEAVE)
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
router.post("/:groupId/leave", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const gid = groupId(req);
    if (!validId(gid)) return fail(res, "VALIDATION", { field: "groupId" });
    const group = await prisma.group.findUnique({ where: { id: gid }, select: { ownerId: true } });
    if (!group) return fail(res, "NOT_FOUND");
    if (group.ownerId === req.user.id) return fail(res, "OWNER_CANNOT_LEAVE");
    const r = await prisma.groupMember.deleteMany({ where: { groupId: gid, userId: req.user.id } });
    return res.json({ success: true, left: r.count > 0 });
  } catch (err) {
    console.error("POST /groups/:groupId/leave error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /groups/{groupId}/transfer:
 *   post:
 *     summary: Transfer ownership to an existing member ({uniqueId}); the previous owner stays a member. `.../members/{uniqueId}/promote` is the same action
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 */
const transferOwnership = async (req: AuthRequest, res: Response, uniqueIdRaw: unknown) => {
  try {
    const g = await loadForOwner(req, res);
    if (!g) return;
    const uniqueId = typeof uniqueIdRaw === "string" ? uniqueIdRaw.trim() : "";
    if (!uniqueId) return fail(res, "VALIDATION", { field: "uniqueId" });
    const target = await prisma.user.findUnique({ where: { uniqueId }, select: { id: true } });
    if (!target) return fail(res, "NOT_FOUND");
    if (target.id === g.ownerId) return res.json({ success: true, transferred: false });
    const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: target.id } }, select: { userId: true } });
    if (!member) return fail(res, "NOT_A_MEMBER");
    await prisma.$transaction([
      prisma.group.update({ where: { id: g.id }, data: { ownerId: target.id } }),
      prisma.groupMember.upsert({ where: { groupId_userId: { groupId: g.id, userId: g.ownerId } }, update: {}, create: { groupId: g.id, userId: g.ownerId, role: "MEMBER" } }),
      // invitations sent by the previous owner no longer make sense
      prisma.groupInvitation.updateMany({ where: { groupId: g.id, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } }),
    ]);
    return res.json({ success: true, transferred: true });
  } catch (err) {
    console.error("transfer ownership error:", err);
    return serverError(res);
  }
};
router.post("/:groupId/transfer", authenticateToken, (req: AuthRequest, res: Response) => transferOwnership(req, res, req.body?.uniqueId));
router.patch("/:groupId/members/:uniqueId/promote", authenticateToken, (req: AuthRequest, res: Response) => transferOwnership(req, res, req.params.uniqueId));

export default router;
