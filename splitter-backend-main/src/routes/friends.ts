import { Router } from "express";
import { isDbId } from "../utils/dbId.js";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { PUBLIC_USER_SELECT } from "../config/userSelect.js";
import { fail, serverError } from "../utils/apiError.js";
import { clampPaging, parseSearchQuery } from "../utils/searchQuery.js";
import { decideFriendRequest, type Row } from "../utils/friendship.js";
import { searchUsers } from "../services/userSearch.js";

const router = Router();

const getFriendInviteSecret = () => process.env.FRIEND_INVITE_SECRET || process.env.JWT_SECRET || "";
const withAvatar = <T extends { avatarUrl: string | null }>(u: T) => ({ ...u, avatarUrl: u.avatarUrl ?? null });
const toRow = (r: { id: number; requesterId: number; receiverId: number; status: string; updatedAt: Date }): Row => ({
  id: r.id, requesterId: r.requesterId, receiverId: r.receiverId, status: r.status as Row["status"], updatedAt: r.updatedAt.getTime(),
});

/** Resolve the other person from `{uniqueId}` or `{requesterId}` (accept / reject keep their old body). */
async function resolveOther(body: any): Promise<number | null> {
  if (body?.requesterId !== undefined) return isDbId(body.requesterId) ? body.requesterId : null;
  if (typeof body?.uniqueId === "string" && body.uniqueId.trim()) {
    const u = await prisma.user.findUnique({ where: { uniqueId: body.uniqueId.trim() }, select: { id: true } });
    return u?.id ?? null;
  }
  return null;
}

const searchIpLimit = rateLimit({ windowMs: 60_000, max: Number(process.env.SEARCH_IP_LIMIT) || 60, name: "search-ip" });
const searchUserLimit = rateLimit({ windowMs: 60_000, max: Number(process.env.SEARCH_USER_LIMIT) || 30, name: "search-user" });
const requestLimit = rateLimit({ windowMs: 60 * 60_000, max: Number(process.env.FRIEND_REQUEST_LIMIT) || 20, name: "friend-request" });

/**
 * @swagger
 * tags:
 *   name: Friends
 *   description: Friends, requests, search and invite links
 */

/**
 * @swagger
 * /friends/search:
 *   get:
 *     summary: Search users by username or ID
 *     description: |
 *       `q` is a username (exact, then prefix, then substring; case-insensitive) or an ID (`#1234`, `1234`, `name#1234`).
 *       Min 2 characters; `limit` <= 20; `offset + limit` <= 100. Rate limit 30/min per user and 60/min per IP.
 *       Optional `groupId` adds `groupStatus` (none | member | invited) for inviting to that group.
 *       Never returns email. Result: `{ results: [{id, username, uniqueId, avatarUrl, relation, groupStatus?}], nextOffset }`.
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.get("/search", searchIpLimit, authenticateToken, searchUserLimit, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const parsed = parseSearchQuery(req.query.q);
    if (parsed.kind === "invalid") return fail(res, "VALIDATION", { field: "q" });
    if (parsed.kind === "empty" || parsed.kind === "short") return res.json({ results: [], nextOffset: null, tooShort: parsed.kind === "short" });
    const { limit, offset } = clampPaging(req.query.limit, req.query.offset);

    let groupId: number | undefined;
    if (req.query.groupId !== undefined) {
      groupId = Number(req.query.groupId);
      if (!isDbId(groupId)) return fail(res, "VALIDATION", { field: "groupId" });
      const g = await prisma.group.findUnique({
        where: { id: groupId },
        select: { ownerId: true, members: { where: { userId: req.user.id }, select: { userId: true } } },
      });
      if (!g) return fail(res, "NOT_FOUND");
      if (g.ownerId !== req.user.id && g.members.length === 0) return fail(res, "FORBIDDEN");
    }
    return res.json({ ...(await searchUsers({ me: req.user.id, parsed, limit, offset, ...(groupId !== undefined ? { groupId } : {}) })), tooShort: false });
  } catch (err) {
    console.error("GET /friends/search error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /friends/invite:
 *   post:
 *     summary: Create a friend invite link (JWT, 1-60 min, reusable until it expires)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.post("/invite", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const secret = getFriendInviteSecret();
    if (!secret) return serverError(res);
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.max(60, Math.min(3600, Number(req.body?.expiresInSeconds) || 900));
    const exp = nowSec + ttl;
    const token = jwt.sign({ typ: "friend_invite" as const, inviterId: req.user.id, iat: nowSec, exp }, secret);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    return res.json({ token, url: `${baseUrl}/friends/join?token=${encodeURIComponent(token)}`, expiresAt: new Date(exp * 1000).toISOString() });
  } catch (err) {
    console.error("POST /friends/invite error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /friends/join:
 *   post:
 *     summary: Become friends by using an invite token (errors TOKEN_EXPIRED, TOKEN_INVALID, REQUEST_NOT_ALLOWED)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.post("/join", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return fail(res, "VALIDATION", { field: "token" });
    const secret = getFriendInviteSecret();
    if (!secret) return serverError(res);

    let decoded: any;
    try {
      decoded = jwt.verify(token, secret);
    } catch (e) {
      return fail(res, e instanceof jwt.TokenExpiredError ? "TOKEN_EXPIRED" : "TOKEN_INVALID");
    }
    if (!decoded || decoded.typ !== "friend_invite" || !Number.isInteger(decoded.inviterId)) return fail(res, "TOKEN_INVALID");

    const inviterId = Number(decoded.inviterId);
    const me = req.user.id;
    if (inviterId === me) return res.json({ success: true, action: "self" });
    const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { id: true } });
    if (!inviter) return fail(res, "TOKEN_INVALID");

    const existing = await prisma.friendship.findFirst({
      where: { OR: [{ requesterId: inviterId, receiverId: me }, { requesterId: me, receiverId: inviterId }] },
    });
    if (existing) {
      if (existing.status === "ACCEPTED") return res.json({ success: true, action: "existing" });
      if (existing.status === "BLOCKED") return fail(res, "REQUEST_NOT_ALLOWED");
      await prisma.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED" } });
      return res.json({ success: true, action: "accepted" });
    }
    await prisma.friendship.create({ data: { requesterId: inviterId, receiverId: me, status: "ACCEPTED" } });
    return res.json({ success: true, action: "created" });
  } catch (err) {
    console.error("POST /friends/join error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /friends:
 *   get:
 *     summary: List friends (public fields only, no email)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const userId = req.user.id;
    const [asRequester, asReceiver] = await Promise.all([
      prisma.friendship.findMany({ where: { requesterId: userId, status: "ACCEPTED" }, include: { receiver: { select: PUBLIC_USER_SELECT } } }),
      prisma.friendship.findMany({ where: { receiverId: userId, status: "ACCEPTED" }, include: { requester: { select: PUBLIC_USER_SELECT } } }),
    ]);
    return res.json([...asRequester.map((f) => f.receiver), ...asReceiver.map((f) => f.requester)].map(withAvatar));
  } catch (err) {
    console.error("GET /friends error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /friends/requests:
 *   get:
 *     summary: Incoming and outgoing pending requests
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.get("/requests", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const userId = req.user.id;
    const [incoming, outgoing] = await Promise.all([
      prisma.friendship.findMany({ where: { receiverId: userId, status: "PENDING" }, include: { requester: { select: PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" } }),
      prisma.friendship.findMany({ where: { requesterId: userId, status: "PENDING" }, include: { receiver: { select: PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" } }),
    ]);
    return res.json({
      incoming: incoming.map((r) => ({ id: r.id, createdAt: r.createdAt, from: withAvatar(r.requester) })),
      outgoing: outgoing.map((r) => ({ id: r.id, createdAt: r.createdAt, to: withAvatar(r.receiver) })),
    });
  } catch (err) {
    console.error("GET /friends/requests error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /friends/request:
 *   post:
 *     summary: Send a friend request by uniqueId
 *     description: Errors CANNOT_ADD_SELF, ALREADY_FRIENDS, REQUEST_EXISTS, REQUEST_COOLDOWN (after a refusal, 7 days), REQUEST_NOT_ALLOWED. 20 per hour per user. A matching incoming request is accepted instead.
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.post("/request", authenticateToken, requestLimit, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const me = req.user.id;
    const uniqueId = req.body?.uniqueId;
    if (typeof uniqueId !== "string" || !uniqueId.trim()) return fail(res, "VALIDATION", { field: "uniqueId" });
    const target = await prisma.user.findUnique({ where: { uniqueId: uniqueId.trim() }, select: { id: true } });
    if (!target) return fail(res, "NOT_FOUND");
    if (target.id === me) return fail(res, "CANNOT_ADD_SELF");

    const rows = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: me, receiverId: target.id }, { requesterId: target.id, receiverId: me }] },
      select: { id: true, requesterId: true, receiverId: true, status: true, updatedAt: true },
    });
    const d = decideFriendRequest(rows.map(toRow), me, Date.now());
    if (d.action === "error") return fail(res, d.code, d.retryAt ? { retryAt: new Date(d.retryAt).toISOString() } : {});
    if (d.action === "accept") {
      await prisma.friendship.update({ where: { id: d.rowId }, data: { status: "ACCEPTED" } });
      return res.json({ success: true, action: "accepted", id: d.rowId });
    }
    if (d.action === "reset") {
      await prisma.friendship.update({ where: { id: d.rowId }, data: { status: "PENDING" } });
      return res.json({ success: true, action: "requested", id: d.rowId });
    }
    try {
      const created = await prisma.$transaction(async (tx) => {
        if (d.action === "replace") await tx.friendship.delete({ where: { id: d.rowId } });
        return tx.friendship.create({ data: { requesterId: me, receiverId: target.id } });
      });
      return res.json({ success: true, action: "requested", id: created.id });
    } catch (e: any) {
      if (e?.code === "P2002") return fail(res, "REQUEST_EXISTS"); // two taps at once
      throw e;
    }
  } catch (err) {
    console.error("POST /friends/request error:", err);
    return serverError(res);
  }
});

const respond = (status: "ACCEPTED" | "REJECTED") => async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const me = req.user.id;
    const otherId = await resolveOther(req.body);
    if (!otherId) return fail(res, "VALIDATION", { field: "uniqueId" });
    const fr = await prisma.friendship.findUnique({ where: { requesterId_receiverId: { requesterId: otherId, receiverId: me } } });
    if (!fr || fr.status !== "PENDING") return fail(res, "NOT_FOUND");
    const updated = await prisma.friendship.update({ where: { id: fr.id }, data: { status } });
    return res.json({ success: true, id: updated.id });
  } catch (err) {
    console.error(`PATCH /friends/${status === "ACCEPTED" ? "accept" : "reject"} error:`, err);
    return serverError(res);
  }
};

/**
 * @swagger
 * /friends/accept:
 *   patch:
 *     summary: Accept an incoming request ({uniqueId} or {requesterId})
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 * /friends/reject:
 *   patch:
 *     summary: Reject an incoming request; the sender can try again after 7 days
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.patch("/accept", authenticateToken, respond("ACCEPTED"));
router.patch("/reject", authenticateToken, respond("REJECTED"));

/**
 * @swagger
 * /friends/requests/{uniqueId}:
 *   delete:
 *     summary: Cancel my pending request to that user (only PENDING; a refusal cannot be undone this way)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/requests/:uniqueId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const target = await prisma.user.findUnique({ where: { uniqueId: String(req.params.uniqueId || "").trim() }, select: { id: true } });
    if (!target) return fail(res, "NOT_FOUND");
    const r = await prisma.friendship.deleteMany({ where: { requesterId: req.user.id, receiverId: target.id, status: "PENDING" } });
    return res.json({ success: true, removed: r.count > 0 });
  } catch (err) {
    console.error("DELETE /friends/requests/:uniqueId error:", err);
    return serverError(res);
  }
});

/**
 * @swagger
 * /friends/{uniqueId}:
 *   delete:
 *     summary: Remove a friend (only accepted friendships)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:uniqueId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, "UNAUTHORIZED");
    const me = req.user.id;
    const uniqueId = String(req.params.uniqueId || "").trim();
    if (!uniqueId) return fail(res, "VALIDATION", { field: "uniqueId" });
    const other = await prisma.user.findUnique({ where: { uniqueId }, select: { id: true } });
    if (!other) return res.json({ success: true, removed: false });
    const r = await prisma.friendship.deleteMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: me, receiverId: other.id }, { requesterId: other.id, receiverId: me }] },
    });
    return res.json({ success: true, removed: r.count > 0 });
  } catch (err) {
    console.error("DELETE /friends/:uniqueId error:", err);
    return serverError(res);
  }
});

export default router;
