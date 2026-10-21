import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { detectImageType } from "../utils/imageType.js";
import { checkImageQuality } from "../utils/imageInfo.js";
import { MONTH_MS, computeQuota, readLimits } from "../utils/scanQuota.js";
import type { QuotaState } from "../utils/scanQuota.js";
import { AiError } from "./geminiClient.js";
import type { ReceiptAi } from "./geminiClient.js";
import { buildReceipt, extractJson, modelReceiptSchema } from "./scanReceipt.js";
import type { ScanReceipt } from "./scanReceipt.js";
import { logScan } from "./scanLog.js";

export type ScanErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "QUOTA_EXCEEDED"
  | "AI_UNAVAILABLE"
  | "NOT_A_RECEIPT"
  | "PARSE_FAILED"
  | "REQUEST_IN_PROGRESS";

const STATUS: Record<ScanErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_IMAGE: 422,
  IMAGE_TOO_LARGE: 413,
  QUOTA_EXCEEDED: 429,
  AI_UNAVAILABLE: 503,
  NOT_A_RECEIPT: 422,
  PARSE_FAILED: 502,
  REQUEST_IN_PROGRESS: 409,
};

export class ScanError extends Error {
  code: ScanErrorCode;
  status: number;
  extra: Record<string, unknown>;
  constructor(code: ScanErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "ScanError";
    this.code = code;
    this.status = STATUS[code];
    this.extra = extra;
  }
}

export type ScanResponse = {
  receipt: ScanReceipt;
  /** answered from an earlier result for the same photo: no AI call, no quota spent */
  cached: boolean;
  /** same Idempotency-Key as an earlier request: stored answer, nothing charged */
  replayed: boolean;
  quota: QuotaState;
};

const maxImageBytes = () => Number(process.env.SCAN_MAX_IMAGE_BYTES) || 3_000_000;
const cacheDays = () => Number(process.env.SCAN_CACHE_DAYS) || 30;
const PENDING_STALE_MS = 3 * 60 * 1000;
const IDEM_RE = /^[A-Za-z0-9_-]{8,100}$/;

// One scan at a time per user (single-process server): makes double taps and quota checks race-free.
const locks = new Map<number, Promise<unknown>>();
async function withUserLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(userId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(userId, tail);
  try {
    return await run;
  } finally {
    if (locks.get(userId) === tail) locks.delete(userId);
  }
}

export async function getQuota(userId: number, now = Date.now()): Promise<QuotaState> {
  const rows = await prisma.scanRequest.findMany({
    where: { userId, charged: true, createdAt: { gt: new Date(now - MONTH_MS) } },
    select: { createdAt: true },
  });
  return computeQuota(
    rows.map((r) => r.createdAt.getTime()),
    now,
    readLimits(process.env)
  );
}

function decodeImage(body: unknown): { buf: Buffer; base64: string } {
  const image = (body as { image?: { data?: unknown } } | null | undefined)?.image;
  if (!image || typeof image !== "object" || typeof image.data !== "string" || image.data.length === 0) {
    throw new ScanError("INVALID_REQUEST", { field: "image" });
  }
  const base64 = image.data.replace(/^data:[^;]+;base64,/, "");
  // 4 base64 chars carry 3 bytes: reject oversized input before allocating the buffer
  if ((base64.length * 3) / 4 > maxImageBytes()) throw new ScanError("IMAGE_TOO_LARGE", { maxBytes: maxImageBytes() });
  const buf = Buffer.from(base64, "base64");
  if (buf.length > maxImageBytes()) throw new ScanError("IMAGE_TOO_LARGE", { maxBytes: maxImageBytes() });
  return { buf, base64 };
}

export async function runScan(args: {
  userId: number;
  body: unknown;
  idempotencyKey?: string | undefined;
  ai: ReceiptAi;
}): Promise<ScanResponse> {
  const { userId, ai } = args;
  const idemKey = args.idempotencyKey?.trim() || undefined;
  if (idemKey !== undefined && !IDEM_RE.test(idemKey)) throw new ScanError("INVALID_REQUEST", { field: "Idempotency-Key" });

  // 1. cheap checks, free of charge
  let decoded: { buf: Buffer; base64: string };
  try {
    decoded = decodeImage(args.body);
  } catch (e) {
    if (e instanceof ScanError) logScan(e.code === "IMAGE_TOO_LARGE" ? "invalid_too_large" : "invalid_request");
    throw e;
  }
  const type = detectImageType(decoded.buf);
  if (!type) {
    logScan("invalid_image");
    throw new ScanError("INVALID_IMAGE", { reason: "UNSUPPORTED_TYPE" });
  }
  const quality = checkImageQuality(decoded.buf);
  if (!quality.ok) {
    logScan("invalid_image");
    throw new ScanError("INVALID_IMAGE", { reason: quality.reason });
  }
  const hintRaw = (args.body as { currency?: unknown }).currency;
  const currencyHint = typeof hintRaw === "string" ? hintRaw : null;
  const language = (args.body as { language?: unknown }).language;
  const imageHash = createHash("sha256").update(decoded.buf).digest("hex");

  return withUserLock(userId, async () => {
    const now = Date.now();

    // 2. idempotent replay
    if (idemKey) {
      const prior = await prisma.scanRequest.findUnique({ where: { userId_idemKey: { userId, idemKey } } });
      if (prior) {
        if (prior.status === "PENDING" && now - prior.createdAt.getTime() < PENDING_STALE_MS) {
          throw new ScanError("REQUEST_IN_PROGRESS");
        }
        if ((prior.status === "OK" || prior.status === "CACHED") && prior.result) {
          logScan("replay");
          return { receipt: prior.result as unknown as ScanReceipt, cached: prior.status === "CACHED", replayed: true, quota: await getQuota(userId) };
        }
        if (prior.status === "FAILED" && prior.charged && prior.errorCode) {
          logScan("replay");
          throw new ScanError(prior.errorCode as ScanErrorCode);
        }
        // abandoned PENDING or an uncharged failure (e.g. AI outage): the client may retry under the same key
        await prisma.scanRequest.delete({ where: { id: prior.id } });
      }
    }

    // 3. cache by image hash (per user): no AI call, no charge
    const since = new Date(now - cacheDays() * 24 * 60 * 60 * 1000);
    const hit = await prisma.scanRequest.findFirst({
      where: { userId, imageHash, status: { in: ["OK", "CACHED"] }, result: { not: Prisma.DbNull }, createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
    });
    if (hit?.result) {
      await prisma.scanRequest.create({
        data: { userId, imageHash, idemKey: idemKey ?? null, status: "CACHED", charged: false, result: hit.result as Prisma.InputJsonValue },
      });
      logScan("cache_hit");
      return { receipt: hit.result as unknown as ScanReceipt, cached: true, replayed: false, quota: await getQuota(userId) };
    }

    // 4. quota
    const quota = await getQuota(userId, now);
    if (quota.remaining <= 0) {
      logScan("quota_block");
      throw new ScanError("QUOTA_EXCEEDED", { resetAt: quota.resetAt, quota });
    }

    // 5. reserve the slot (charged=true) BEFORE the paid call
    let row: { id: string };
    try {
      row = await prisma.scanRequest.create({
        data: { userId, imageHash, idemKey: idemKey ?? null, status: "PENDING", charged: true },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ScanError("REQUEST_IN_PROGRESS");
      throw e;
    }
    const fail = async (code: ScanErrorCode, charged: boolean) => {
      await prisma.scanRequest.update({ where: { id: row.id }, data: { status: "FAILED", errorCode: code, charged } });
      throw new ScanError(code);
    };

    // 6. the single paid call
    const started = Date.now();
    let text: string;
    try {
      text = await ai({ imageBase64: decoded.base64, mimeType: type.mime, language: typeof language === "string" ? language : undefined });
    } catch (e) {
      logScan("ai_error", { ms: Date.now() - started, status: e instanceof AiError ? e.status : undefined });
      // no answer from the model: the user is not charged
      return fail("AI_UNAVAILABLE", false);
    }
    logScan("ai_call", { ms: Date.now() - started });

    // 7. validate and normalise
    let parsed;
    try {
      parsed = modelReceiptSchema.safeParse(extractJson(text));
    } catch {
      return fail("PARSE_FAILED", true);
    }
    if (!parsed.success) return fail("PARSE_FAILED", true);
    if (!parsed.data.isReceipt || parsed.data.items.length === 0) return fail("NOT_A_RECEIPT", true);

    const receipt = buildReceipt(parsed.data, currencyHint);
    await prisma.scanRequest.update({
      where: { id: row.id },
      data: { status: "OK", result: receipt as unknown as Prisma.InputJsonValue },
    });
    return { receipt, cached: false, replayed: false, quota: await getQuota(userId) };
  });
}
