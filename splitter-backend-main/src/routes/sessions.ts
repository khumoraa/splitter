import { Router } from "express";
import { isDbId } from "../utils/dbId.js";
import type { Response } from "express";
import { prisma } from "../config/prisma.js";
import type { Prisma } from "@prisma/client";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { getQuota, runScan, ScanError } from "../services/scanService.js";
import { geminiReceiptAi, mockCallCount, mockReceiptAi } from "../services/geminiClient.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { fromMinor, splitMinor, toMinor } from "../utils/money.js";
import { parseMoneyField, validateBillInput } from "../utils/sessionInput.js";

const router = Router();

const DEFAULT_CURRENCY_CODE = "UNKNOWN";

function normalizeCurrencyCode(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_CURRENCY_CODE;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_CURRENCY_CODE;
  const upper = trimmed.toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : DEFAULT_CURRENCY_CODE;
}


/**
 * @swagger
 * /sessions/scan/quota:
 *   get:
 *     summary: Remaining AI receipt recognitions for the current user
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ remaining, limit, resetAt, daily, monthly }"
 * /sessions/scan:
 *   post:
 *     summary: Recognise a receipt photo (one paid AI call; cached by image hash)
 *     description: |
 *       Body `{ image: { mimeType, data(base64) }, language?, currency? }`; optional `Idempotency-Key` header.
 *       The photo is never stored. Does NOT create a session (the client creates it with POST /sessions).
 *       Errors carry a stable `code`: INVALID_IMAGE (422, `reason`), IMAGE_TOO_LARGE (413), QUOTA_EXCEEDED (429, `resetAt`),
 *       AI_UNAVAILABLE (503), NOT_A_RECEIPT (422), PARSE_FAILED (502), REQUEST_IN_PROGRESS (409), INVALID_REQUEST (400).
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ receipt, cached, replayed, quota }; amounts are integer minor units; receipt.warnings may hold TOTAL_MISMATCH"
 */
router.get("/scan/quota", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return res.json(await getQuota(req.user.id));
  } catch (err) {
    console.error("GET /sessions/scan/quota error", err);
    return res.status(500).json({ error: "Server error", code: "SERVER_ERROR" });
  }
});

const scanLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "scan" });

router.post("/scan", authenticateToken, scanLimiter, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    const mockMode = process.env.ALLOW_MOCK_SCAN === "true";
    const ai = mockMode ? mockReceiptAi(String(req.header("x-mock-ai") ?? "ok")) : geminiReceiptAi;
    const result = await runScan({
      userId: req.user.id,
      body: req.body,
      idempotencyKey: req.header("idempotency-key") ?? undefined,
      ai,
    });
    return res.json(mockMode ? { ...result, _mockAiCalls: mockCallCount() } : result);
  } catch (err) {
    if (err instanceof ScanError) {
      if (err.code === "QUOTA_EXCEEDED") res.setHeader("Retry-After", "3600");
      return res.status(err.status).json({ error: err.code, code: err.code, ...err.extra });
    }
    console.error("POST /sessions/scan error", err);
    return res.status(500).json({ error: "Server error", code: "SERVER_ERROR" });
  }
});

/**
 * @swagger
 * tags:
 *   name: Sessions
 *   description: Receipt split sessions
 */

/**
 * @swagger
 * /sessions:
 *   post:
 *     summary: Create a session (optionally within a group)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               groupId:
 *                 type: integer
 *                 nullable: true
 *               serviceFee:
 *                 type: number
 *                 nullable: true
 *               total:
 *                 type: number
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Session created
 */
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const groupId = req.body?.groupId;
    const serviceFee = parseMoneyField(req.body?.serviceFee);
    const total = parseMoneyField(req.body?.total);
    if (serviceFee === null || total === null) {
      return res.status(400).json({ error: "Invalid amount", code: "INVALID_REQUEST" });
    }

    let groupCheck = null as null | { ownerId: number };
    if (groupId != null) {
      const gid = Number(groupId);
      if (!isDbId(gid))
        return res.status(400).json({ error: "Invalid groupId" });
      groupCheck = await prisma.group.findUnique({
        where: { id: gid },
        select: { ownerId: true },
      });
      if (!groupCheck)
        return res.status(404).json({ error: "Group not found" });
    }

    const created = await prisma.session.create({
      data: {
        creatorId: req.user.id,
        groupId: groupId != null ? Number(groupId) : null,
        serviceFee: serviceFee || 0,
        total: total || 0,
      },
    });
    console.log("/sessions create:", {
      id: created.id,
      groupId: created.groupId,
    });
    return res.json(created);
  } catch (err) {
    console.error("POST /sessions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /sessions:
 *   get:
 *     summary: List sessions (by group or personal created)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Sessions list
 */
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const groupId =
      req.query.groupId != null ? Number(req.query.groupId) : undefined;
    if (groupId !== undefined && !isDbId(groupId)) return res.status(400).json({ error: "Invalid groupId", code: "VALIDATION" });
    if (groupId && Number.isFinite(groupId)) {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: req.user.id } },
        select: { userId: true },
      });
      const grp = membership
        ? null
        : await prisma.group.findFirst({
            where: { id: groupId, ownerId: req.user.id },
            select: { id: true },
          });
      if (!membership && !grp) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    const where =
      groupId && Number.isFinite(groupId)
        ? { groupId }
        : { creatorId: req.user.id };

    const sessions = await prisma.session.findMany({
      where,
      orderBy: { id: "desc" },
      select: {
        id: true,
        creatorId: true,
        groupId: true,
        total: true,
        serviceFee: true,
        status: true,
        createdAt: true,
      },
    });
    return res.json(sessions);
  } catch (err) {
    console.error("GET /sessions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /sessions/{sessionId}/close:
 *   patch:
 *     summary: Close a session (creator only)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Session closed
 */
router.patch(
  "/:sessionId/close",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const sessionId = Number(req.params.sessionId);
      if (!isDbId(sessionId))
        return res.status(400).json({ error: "Invalid sessionId" });
      const s = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { creatorId: true, status: true },
      });
      if (!s) return res.status(404).json({ error: "Session not found" });
      if (s.creatorId !== req.user.id)
        return res.status(403).json({ error: "Forbidden" });

      const updated = await prisma.session.update({
        where: { id: sessionId },
        data: { status: "CLOSED" },
      });
      console.log("/sessions close:", { id: sessionId });
      return res.json(updated);
    } catch (err) {
      console.error("PATCH /sessions/:sessionId/close error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/finalize:
 *   post:
 *     summary: Finalize a session by computing allocations for provided items & participants (purely computational for now)
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, participants, items]
 *             properties:
 *               currency: { type: string, example: "JPY", nullable: true }
 *               sessionId: { type: integer }
 *               sessionName: { type: string }
 *               participants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [uniqueId, username]
 *                   properties:
 *                     uniqueId: { type: string }
 *                     username: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, name, price, quantity, splitMode]
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     price: { type: number }
 *                     quantity: { type: number }
 *                     kind: { type: string, nullable: true }
 *                     splitMode: { type: string, enum: [equal, count] }
 *                     perPersonCount: { type: object, additionalProperties: { type: number } }
 *                     assignedTo: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Finalized allocations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: integer }
 *                 sessionName: { type: string, nullable: true }
 *                 status: { type: string }
 *                 finalizedAt: { type: string, format: date-time }
 *                 createdAt: { type: string, format: date-time }
 *                 currency: { type: string }
 *                 totals:
 *                   type: object
 *                   properties:
 *                     currency: { type: string }
 *                     grandTotal: { type: number }
 *                     byParticipant:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           uniqueId: { type: string }
 *                           username: { type: string }
 *                           amountOwed: { type: number }
 *                           participantId: { type: string }
 *                           total: { type: number }
 *                     byItem:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           itemId: { type: string }
 *                           name: { type: string }
 *                           total: { type: number }
 *                           kind: { type: string, nullable: true }
 *                 allocations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       itemId: { type: string }
 *                       participantId: { type: string }
 *                       shareAmount: { type: number }
 *                       shareRatio: { type: number, nullable: true }
 *                       shareUnits: { type: number, nullable: true }
 */
router.post(
  "/finalize",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { sessionId, sessionName, participants, items } = req.body || {};
      const currency = normalizeCurrencyCode(req.body?.currency);
      if (!isDbId(Number(sessionId))) {
        return res.status(400).json({ error: "sessionId required" });
      }
      const problem = validateBillInput(items, participants);
      if (problem) {
        return res.status(400).json({ error: "Invalid bill", code: problem.code, field: problem.field, index: problem.index });
      }

      const session = await prisma.session.findUnique({
        where: { id: Number(sessionId) },
        select: { id: true, creatorId: true, createdAt: true },
      });
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.creatorId !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      // The session creator paid the bill: everyone else owes their share to them.
      const payer = await prisma.user.findUnique({
        where: { id: session.creatorId },
        select: { uniqueId: true, username: true },
      });

      interface ParticipantInfo {
        uniqueId: string;
        username: string;
      }
      interface ItemInput {
        id: string;
        name: string;
        price?: number;
        unitPrice?: number;
        totalPrice?: number;
        quantity: number;
        kind?: string;
        splitMode?: "equal" | "count";
        perPersonCount?: Record<string, number>;
        assignedTo?: string[];
      }
      const pList: ParticipantInfo[] = participants.map((p: any) => ({
        uniqueId: String(p.uniqueId),
        username: String(p.username || p.uniqueId),
      }));
      const participantIndex = new Map<string, ParticipantInfo>();
      for (const p of pList) participantIndex.set(p.uniqueId, p);

      const allocs: any[] = [];
      // We'll derive totals AFTER generating allocations to have a single source of truth.
      const itemMeta = new Map<string, { name: string; kind?: string }>();

      // All money math below is done in integer cents (see utils/money.ts) so that
      // the shares of every item sum exactly to the item total.
      let itemIndex = 0;

      if (process.env.DEBUG_PARSE === "1") {
        console.log(
          "[finalize] participants=",
          pList.length,
          "items=",
          items.length
        );
      }

      for (const raw of items as ItemInput[]) {
        if (!raw || typeof raw !== "object") continue;
        const rotation = itemIndex++;
        const { id, name, quantity } = raw;
        // prefer explicit price/unitPrice; else derive from totalPrice/quantity
        let unitPrice = Number(
          raw.price ??
            raw.unitPrice ??
            (raw.totalPrice && quantity
              ? Number(raw.totalPrice) / Number(quantity)
              : NaN)
        );
        const qty = Number(quantity);
        // infer splitMode if missing
        let splitMode: "equal" | "count" | undefined = raw.splitMode;
        if (!splitMode) {
          if (raw.perPersonCount) splitMode = "count";
          else splitMode = "equal";
        }
        if (
          !id ||
          !name ||
          !Number.isFinite(unitPrice) ||
          !Number.isFinite(qty) ||
          qty <= 0
        ) {
          return res
            .status(400)
            .json({ error: `Invalid item fields for id=${id}` });
        }
        if (raw.kind != null) {
          itemMeta.set(id, { name, kind: raw.kind });
        } else {
          itemMeta.set(id, { name });
        }

        if (splitMode === "count") {
          const counts = raw.perPersonCount || {};
          // Validate participants
          let sumUnits = 0;
          for (const [pid, units] of Object.entries(counts)) {
            if (!participantIndex.has(pid)) {
              return res.status(400).json({
                error: `Unknown participant in perPersonCount: ${pid}`,
              });
            }
            const u = Number(units) || 0;
            if (u < 0)
              return res
                .status(400)
                .json({ error: `Negative units for ${pid}` });
            sumUnits += u;
          }
          if (sumUnits !== qty) {
            return res.status(400).json({
              error: `Sum of perPersonCount (${sumUnits}) must equal quantity (${qty}) for item ${id}`,
            });
          }
          for (const [pid, units] of Object.entries(counts)) {
            const u = Number(units) || 0;
            const shareMinor = toMinor(u * unitPrice);
            allocs.push({
              itemId: id,
              participantId: pid,
              shareUnits: u,
              shareAmount: fromMinor(shareMinor),
              shareMinor,
            });
            // participant totals will be derived later
          }
        } else if (splitMode === "equal") {
          const assigned = Array.isArray(raw.assignedTo) ? raw.assignedTo : [];
          if (assigned.length === 0) {
            return res.status(400).json({
              error: `assignedTo required for equal split item ${id}`,
            });
          }
          const valid = Array.from(new Set(assigned)).filter((pid) =>
            participantIndex.has(pid)
          );
          if (valid.length !== new Set(assigned).size) {
            return res.status(400).json({
              error: `Unknown participant in assignedTo for item ${id}`,
            });
          }
          const ratio = 1 / valid.length;
          const shares = splitMinor(toMinor(unitPrice * qty), valid.length, rotation);
          valid.forEach((pid, idx) => {
            const shareMinor = shares[idx]!;
            allocs.push({
              itemId: id,
              participantId: pid,
              shareRatio: ratio,
              shareAmount: fromMinor(shareMinor),
              shareMinor,
            });
          });
        } else {
          return res.status(400).json({
            error: `Unsupported splitMode '${splitMode}' for item ${id}`,
          });
        }
      }

      // Derive totals from allocations
      const byItemMap = new Map<
        string,
        { itemId: string; name: string; total: number; kind?: string }
      >();
      const byItemMinor = new Map<string, number>();
      const byParticipantMinor = new Map<string, number>();
      for (const a of allocs) {
        const itemId = a.itemId;
        const shareMinor: number = a.shareMinor;
        if (!byItemMap.has(itemId)) {
          const meta = itemMeta.get(itemId);
          byItemMap.set(itemId, {
            itemId,
            name: meta?.name || itemId,
            total: 0,
            ...(meta?.kind ? { kind: meta.kind } : {}),
          });
        }
        byItemMinor.set(itemId, (byItemMinor.get(itemId) || 0) + shareMinor);
        const pid = a.participantId;
        byParticipantMinor.set(pid, (byParticipantMinor.get(pid) || 0) + shareMinor);
      }
      const byItem = Array.from(byItemMap.values()).map((it) => ({
        ...it,
        total: fromMinor(byItemMinor.get(it.itemId) || 0),
      }));
      let grandMinor = 0;
      for (const v of byItemMinor.values()) grandMinor += v;
      const grandTotal = fromMinor(grandMinor);
      const byParticipant = pList.map((p) => {
        const amount = fromMinor(byParticipantMinor.get(p.uniqueId) || 0);
        return {
          uniqueId: p.uniqueId,
          username: p.username,
          amountOwed: amount,
          participantId: p.uniqueId,
          total: amount,
        };
      });
      if (process.env.DEBUG_PARSE === "1") {
        console.log("[finalize] derived byItem=", byItem);
        console.log("[finalize] derived byParticipant=", byParticipant);
      }

      const createdAtIso = session.createdAt.toISOString();
      const finalizedAt = new Date();
      const finalizedAtIso = finalizedAt.toISOString();
      const responsePayload = {
        sessionId: Number(sessionId),
        sessionName: sessionName || null,
        status: "finalized",
        createdAt: createdAtIso,
        finalizedAt: finalizedAtIso,
        currency,
        payer,
        totals: {
          currency,
          grandTotal,
          byParticipant,
          byItem,
        },
        allocations: allocs.map(({ shareMinor: _shareMinor, ...rest }) => rest),
      } satisfies Record<string, unknown>;

      const participantUniqueIds = Array.from(
        new Set(byParticipant.map((p) => p.uniqueId))
      ).sort();

      await prisma.sessionHistoryEntry.upsert({
        where: { sessionId: session.id },
        create: {
          sessionId: session.id,
          creatorId: session.creatorId,
          sessionName: sessionName ?? null,
          payload: responsePayload as Prisma.JsonObject,
          participantUniqueIds,
          grandTotal: grandTotal.toString(),
          currency,
          finalizedAt,
        },
        update: {
          sessionName: sessionName ?? null,
          payload: responsePayload as Prisma.JsonObject,
          participantUniqueIds,
          grandTotal: grandTotal.toString(),
          currency,
          finalizedAt,
        },
      });

      return res.json(responsePayload);
    } catch (err) {
      console.error("POST /sessions/finalize error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @swagger
 * /sessions/history:
 *   get:
 *     summary: Session finalize history for the current user
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: all
 *         schema:
 *           type: boolean
 *         description: Return full history when true (defaults to latest 5)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *         description: Override default result size when not requesting all
 *     responses:
 *       200:
 *         description: Session history entries
 */
router.get(
  "/history",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const requesterId = req.user.id;

      const userRecord = await prisma.user.findUnique({
        where: { id: requesterId },
        select: { uniqueId: true },
      });
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      const allParam = String(req.query.all ?? "").toLowerCase();
      const fetchAll = allParam === "1" || allParam === "true";

      let limit = 5;
      if (!fetchAll && req.query.limit != null) {
        const parsed = Number(req.query.limit);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res
            .status(400)
            .json({ error: "limit must be a positive integer" });
        }
        limit = Math.min(Math.trunc(parsed), 50);
      }

      const filters: Prisma.SessionHistoryEntryWhereInput[] = [
        { creatorId: requesterId },
      ];
      if (userRecord.uniqueId) {
        filters.push({ participantUniqueIds: { has: userRecord.uniqueId } });
      }
      const whereFilter: Prisma.SessionHistoryEntryWhereInput =
        filters.length > 1 ? { OR: filters } : filters[0]!;

      const entries = await prisma.sessionHistoryEntry.findMany({
        where: whereFilter,
        orderBy: { finalizedAt: "desc" },
        include: { creator: { select: { uniqueId: true, username: true } } },
        ...(fetchAll ? {} : { take: limit }),
      });

      const response = entries.map((entry) => ({
        sessionId: entry.sessionId,
        sessionName: entry.sessionName,
        finalizedAt: entry.finalizedAt.toISOString(),
        grandTotal: entry.grandTotal.toNumber(),
        currency: entry.currency,
        participantUniqueIds: entry.participantUniqueIds,
        isCreator: entry.creatorId === requesterId,
        // the creator paid the bill (see /sessions/finalize)
        payer: entry.creator,
        payload: entry.payload,
      }));

      return res.json({
        scope: fetchAll ? "all" : "latest",
        count: response.length,
        limit: fetchAll ? null : limit,
        entries: response,
      });
    } catch (err) {
      console.error("GET /sessions/history error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
