import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { PUBLIC_USER_SELECT } from "../config/userSelect.js";
import {
  can, checkPayment, deriveStatus, isTerminal, MAX_NOTE_LEN, obligationsFromShares, outstandingMinor, planSync,
  reminderAllowed, type Action, type ObligationStatus, type Role,
} from "../utils/obligationLogic.js";

type Tx = Prisma.TransactionClient;
type PublicUser = { id: number; username: string; uniqueId: string; avatarUrl: string | null };
const pub = (u: PublicUser) => ({ id: u.id, username: u.username, uniqueId: u.uniqueId, avatarUrl: u.avatarUrl ?? null });

export class PaymentError extends Error {
  code: string;
  extra: Record<string, unknown>;
  constructor(code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------- finalize -> obligations

/**
 * Computes the obligations of a bill from its shares and checks they may be written. Throws SESSION_LOCKED when the
 * bill would change debts that already have recorded payments. Returns a function that applies the change in a tx.
 */
export async function planBillObligations(args: { sessionId: number; payerId: number; currency: string; shares: { uniqueId: string; minor: number }[] }) {
  const users = await prisma.user.findMany({ where: { uniqueId: { in: args.shares.map((s) => s.uniqueId) } }, select: { id: true, uniqueId: true } });
  const idOf = new Map(users.map((u) => [u.uniqueId, u.id]));
  const shares = args.shares.flatMap((s) => (idOf.has(s.uniqueId) ? [{ userId: idOf.get(s.uniqueId)!, minor: s.minor }] : []));
  const desired = obligationsFromShares(shares, args.payerId, args.currency);
  const existing = await prisma.obligation.findMany({
    where: { sessionId: args.sessionId },
    select: { id: true, debtorId: true, creditorId: true, amountMinor: true, currency: true, status: true, _count: { select: { payments: true } } },
  });
  const plan = planSync(existing.map((e) => ({ ...e, status: e.status as ObligationStatus, hasPayments: e._count.payments > 0 })), desired);
  if (plan.locked) throw new PaymentError("SESSION_LOCKED");
  return async (tx: Tx, actorId: number) => {
    for (const id of plan.cancel) {
      await tx.obligation.update({ where: { id }, data: { status: "CANCELLED" } });
      await tx.obligationEvent.create({ data: { obligationId: id, sessionId: args.sessionId, actorId, type: "CANCELLED", note: "bill changed before any payment" } });
    }
    for (const d of plan.create) {
      const o = await tx.obligation.create({ data: { sessionId: args.sessionId, ...d } });
      await tx.obligationEvent.create({ data: { obligationId: o.id, sessionId: args.sessionId, actorId, type: "CREATED", amountMinor: d.amountMinor } });
    }
  };
}

// ---------------------------------------------------------------- reading

/** May this user see the bill's obligations? Creator, anyone listed in the bill, or a party to one of its debts. */
export async function canViewSession(sessionId: number, userId: number): Promise<boolean> {
  const [session, me, party] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { creatorId: true, historyEntry: { select: { participantUniqueIds: true } } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { uniqueId: true } }),
    prisma.obligation.findFirst({ where: { sessionId, OR: [{ debtorId: userId }, { creditorId: userId }] }, select: { id: true } }),
  ]);
  if (!session) return false;
  if (session.creatorId === userId || party) return true;
  return !!me && !!session.historyEntry?.participantUniqueIds.includes(me.uniqueId);
}

const roleOf = (o: { debtorId: number; creditorId: number }, userId: number, participant: boolean): Role =>
  o.creditorId === userId ? "creditor" : o.debtorId === userId ? "debtor" : participant ? "participant" : "outsider";

const ACTIONS: Action[] = ["markPaid", "recordReceived", "confirm", "reject", "forgive", "remind"];

export function obligationView(
  o: Prisma.ObligationGetPayload<{ include: { debtor: { select: typeof PUBLIC_USER_SELECT }; creditor: { select: typeof PUBLIC_USER_SELECT }; payments: { include: { recordedBy: { select: typeof PUBLIC_USER_SELECT }; resolvedBy: { select: typeof PUBLIC_USER_SELECT } } } } }>,
  viewerId: number
) {
  const status = o.status as ObligationStatus;
  const role = roleOf(o, viewerId, true);
  const closed = isTerminal(status) || status === "PAID";
  return {
    id: o.id,
    sessionId: o.sessionId,
    currency: o.currency,
    amountMinor: o.amountMinor,
    confirmedMinor: o.confirmedMinor,
    pendingMinor: o.pendingMinor,
    outstandingMinor: outstandingMinor(o, status),
    status,
    debtor: pub(o.debtor),
    creditor: pub(o.creditor),
    myRole: role,
    lastReminderAt: o.lastReminderAt,
    // what the server will accept from this viewer right now (the client also derives it for its buttons)
    allowedActions: closed ? [] : ACTIONS.filter((a) => can(role, a) && (a !== "confirm" && a !== "reject" ? true : o.payments.some((p) => p.status === "PENDING"))),
    payments: o.payments.map((p) => ({
      id: p.id,
      amountMinor: p.amountMinor,
      method: p.method,
      note: p.note,
      status: p.status,
      recordedBy: pub(p.recordedBy),
      resolvedBy: p.resolvedBy ? pub(p.resolvedBy) : null,
      rejectionReason: p.rejectionReason,
      createdAt: p.createdAt,
      resolvedAt: p.resolvedAt,
    })),
    createdAt: o.createdAt,
  };
}

export const OBLIGATION_INCLUDE = {
  debtor: { select: PUBLIC_USER_SELECT },
  creditor: { select: PUBLIC_USER_SELECT },
  payments: { orderBy: { createdAt: "asc" }, include: { recordedBy: { select: PUBLIC_USER_SELECT }, resolvedBy: { select: PUBLIC_USER_SELECT } } },
} satisfies Prisma.ObligationInclude;

export async function sessionLedger(sessionId: number, viewerId: number) {
  const [session, obligations, events] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, createdAt: true, creator: { select: PUBLIC_USER_SELECT }, group: { select: { id: true, name: true } }, historyEntry: { select: { sessionName: true, currency: true, finalizedAt: true, grandTotal: true, payload: true } } },
    }),
    prisma.obligation.findMany({ where: { sessionId, status: { not: "CANCELLED" } }, include: OBLIGATION_INCLUDE, orderBy: { id: "asc" } }),
    prisma.obligationEvent.findMany({ where: { sessionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { actor: { select: PUBLIC_USER_SELECT } } }),
  ]);
  if (!session) throw new PaymentError("NOT_FOUND");
  const views = obligations.map((o) => obligationView(o, viewerId));
  const sum = (f: (v: (typeof views)[number]) => number) => views.reduce((s, v) => s + f(v), 0);
  const payload = (session.historyEntry?.payload ?? {}) as { totals?: { grandTotalMinor?: number } };
  return {
    session: {
      id: session.id,
      name: session.historyEntry?.sessionName ?? null,
      currency: session.historyEntry?.currency ?? null,
      finalizedAt: session.historyEntry?.finalizedAt ?? null,
      createdAt: session.createdAt,
      payer: pub(session.creator),
      group: session.group,
      grandTotalMinor: payload.totals?.grandTotalMinor ?? null,
    },
    obligations: views,
    events: events.map((e) => ({ id: e.id, obligationId: e.obligationId, type: e.type, amountMinor: e.amountMinor, paymentId: e.paymentId, note: e.note, actor: pub(e.actor), createdAt: e.createdAt })),
    totals: {
      // all obligations of one bill share its currency
      currency: views[0]?.currency ?? session.historyEntry?.currency ?? null,
      amountMinor: sum((v) => v.amountMinor),
      settledMinor: sum((v) => v.confirmedMinor),
      pendingMinor: sum((v) => v.pendingMinor),
      outstandingMinor: sum((v) => v.outstandingMinor),
      forgivenMinor: sum((v) => (v.status === "FORGIVEN" ? v.amountMinor - v.confirmedMinor : 0)),
    },
  };
}

// ---------------------------------------------------------------- writing (one obligation at a time, row-locked)

async function lockObligation(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT "id" FROM "Obligation" WHERE "id" = ${id} FOR UPDATE`;
  const o = await tx.obligation.findUnique({ where: { id } });
  if (!o) throw new PaymentError("NOT_FOUND");
  return o;
}

async function roleFor(tx: Tx, o: { sessionId: number; debtorId: number; creditorId: number }, userId: number): Promise<Role> {
  if (o.creditorId === userId) return "creditor";
  if (o.debtorId === userId) return "debtor";
  const s = await tx.session.findUnique({ where: { id: o.sessionId }, select: { creatorId: true, historyEntry: { select: { participantUniqueIds: true } } } });
  const me = await tx.user.findUnique({ where: { id: userId }, select: { uniqueId: true } });
  const participant = !!s && (s.creatorId === userId || (!!me && !!s.historyEntry?.participantUniqueIds.includes(me.uniqueId)));
  return participant ? "participant" : "outsider";
}

/** Outsiders must not even learn that the debt exists. */
function deny(role: Role): never {
  throw new PaymentError(role === "outsider" ? "NOT_FOUND" : "FORBIDDEN");
}

const cleanNote = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new PaymentError("VALIDATION", { field: "note" });
  const t = v.trim();
  if (t.length > MAX_NOTE_LEN) throw new PaymentError("VALIDATION", { field: "note" });
  return t || null;
};

const METHODS = new Set(["CASH", "TRANSFER", "OTHER"]);
const IDEM_RE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * "I paid" (debtor -> PENDING) or "Received" (creditor -> CONFIRMED). Partial amounts are allowed; the total of
 * confirmed + pending payments can never exceed the debt (also a CHECK in the database).
 * A repeated request with the same Idempotency-Key returns the first payment instead of recording a second one.
 */
export async function recordPayment(args: { obligationId: number; userId: number; amountMinor?: unknown; method?: unknown; note?: unknown; idemKey?: string | undefined }) {
  const { obligationId, userId } = args;
  if (args.idemKey !== undefined && !IDEM_RE.test(args.idemKey)) throw new PaymentError("VALIDATION", { field: "Idempotency-Key" });
  const method = args.method === undefined ? "OTHER" : String(args.method).toUpperCase();
  if (!METHODS.has(method)) throw new PaymentError("VALIDATION", { field: "method" });
  if (args.amountMinor !== undefined && (typeof args.amountMinor !== "number" || !Number.isInteger(args.amountMinor))) throw new PaymentError("VALIDATION", { field: "amountMinor" });
  const note = cleanNote(args.note);

  try {
    return await prisma.$transaction(async (tx) => {
      const o = await lockObligation(tx, obligationId);
      if (args.idemKey) {
        const prior = await tx.obligationPayment.findUnique({ where: { obligationId_recordedById_idemKey: { obligationId, recordedById: userId, idemKey: args.idemKey } } });
        if (prior) return { payment: prior, replayed: true };
      }
      const role = await roleFor(tx, o, userId);
      const action: Action = role === "creditor" ? "recordReceived" : "markPaid";
      if (!can(role, action)) deny(role);
      const check = checkPayment(o, o.status as ObligationStatus, args.amountMinor as number | undefined);
      if (!check.ok) throw new PaymentError(check.code, { recordableMinor: Math.max(0, o.amountMinor - o.confirmedMinor - o.pendingMinor) });

      const confirmed = role === "creditor";
      const payment = await tx.obligationPayment.create({
        data: {
          obligationId, amountMinor: check.amountMinor, method: method as "CASH" | "TRANSFER" | "OTHER", note,
          status: confirmed ? "CONFIRMED" : "PENDING", recordedById: userId, idemKey: args.idemKey ?? null,
          ...(confirmed ? { resolvedById: userId, resolvedAt: new Date() } : {}),
        },
      });
      const amounts = {
        amountMinor: o.amountMinor,
        confirmedMinor: o.confirmedMinor + (confirmed ? check.amountMinor : 0),
        pendingMinor: o.pendingMinor + (confirmed ? 0 : check.amountMinor),
      };
      await tx.obligation.update({ where: { id: obligationId }, data: { ...amounts, status: deriveStatus(amounts) } });
      await tx.obligationEvent.create({
        data: { obligationId, sessionId: o.sessionId, actorId: userId, type: confirmed ? "PAYMENT_RECORDED" : "PAYMENT_MARKED", amountMinor: check.amountMinor, paymentId: payment.id, note },
      });
      return { payment, replayed: false };
    });
  } catch (e) {
    // two identical requests at the same moment: the unique key lets one through, the other replays it
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && args.idemKey) {
      const prior = await prisma.obligationPayment.findUnique({ where: { obligationId_recordedById_idemKey: { obligationId, recordedById: userId, idemKey: args.idemKey } } });
      if (prior) return { payment: prior, replayed: true };
    }
    throw e;
  }
}

/** Creditor confirms or rejects a debtor's "I paid". Rejection needs a reason. */
export async function resolvePayment(args: { obligationId: number; paymentId: number; userId: number; confirm: boolean; reason?: unknown }) {
  const reason = args.confirm ? null : cleanNote(args.reason);
  if (!args.confirm && !reason) throw new PaymentError("VALIDATION", { field: "reason" });
  return prisma.$transaction(async (tx) => {
    const o = await lockObligation(tx, args.obligationId);
    const role = await roleFor(tx, o, args.userId);
    if (!can(role, args.confirm ? "confirm" : "reject")) deny(role);
    const p = await tx.obligationPayment.findFirst({ where: { id: args.paymentId, obligationId: o.id } });
    if (!p) throw new PaymentError("NOT_FOUND");
    if (p.status !== "PENDING") throw new PaymentError("PAYMENT_NOT_PENDING");
    if (isTerminal(o.status as ObligationStatus)) throw new PaymentError("OBLIGATION_CLOSED");
    await tx.obligationPayment.update({
      where: { id: p.id },
      data: { status: args.confirm ? "CONFIRMED" : "REJECTED", resolvedById: args.userId, resolvedAt: new Date(), rejectionReason: reason },
    });
    const amounts = {
      amountMinor: o.amountMinor,
      confirmedMinor: o.confirmedMinor + (args.confirm ? p.amountMinor : 0),
      pendingMinor: o.pendingMinor - p.amountMinor,
    };
    await tx.obligation.update({ where: { id: o.id }, data: { ...amounts, status: deriveStatus(amounts) } });
    await tx.obligationEvent.create({
      data: { obligationId: o.id, sessionId: o.sessionId, actorId: args.userId, type: args.confirm ? "PAYMENT_CONFIRMED" : "PAYMENT_REJECTED", amountMinor: p.amountMinor, paymentId: p.id, note: reason },
    });
    return { status: deriveStatus(amounts) };
  });
}

/** Creditor waives what is left. Pending "I paid" marks must be answered first, so nobody's claim is silently dropped. */
export async function forgive(args: { obligationId: number; userId: number; note?: unknown }) {
  const note = cleanNote(args.note);
  return prisma.$transaction(async (tx) => {
    const o = await lockObligation(tx, args.obligationId);
    const role = await roleFor(tx, o, args.userId);
    if (!can(role, "forgive")) deny(role);
    const status = o.status as ObligationStatus;
    if (isTerminal(status) || status === "PAID") throw new PaymentError("OBLIGATION_CLOSED");
    if (o.pendingMinor > 0) throw new PaymentError("PENDING_PAYMENTS");
    await tx.obligation.update({ where: { id: o.id }, data: { status: "FORGIVEN" } });
    await tx.obligationEvent.create({ data: { obligationId: o.id, sessionId: o.sessionId, actorId: args.userId, type: "FORGIVEN", amountMinor: o.amountMinor - o.confirmedMinor, note } });
    return { status: "FORGIVEN" as const };
  });
}

/** Records that the creditor sent a reminder (the message itself goes through the phone's Share sheet). Once per 24 h. */
export async function remind(args: { obligationId: number; userId: number }) {
  return prisma.$transaction(async (tx) => {
    const o = await lockObligation(tx, args.obligationId);
    const role = await roleFor(tx, o, args.userId);
    if (!can(role, "remind")) deny(role);
    const status = o.status as ObligationStatus;
    if (isTerminal(status) || status === "PAID") throw new PaymentError("OBLIGATION_CLOSED");
    const r = reminderAllowed(o.lastReminderAt ? o.lastReminderAt.getTime() : null, Date.now());
    if (!r.ok) throw new PaymentError("REMINDER_TOO_SOON", { retryAt: new Date(r.retryAt).toISOString() });
    const now = new Date();
    await tx.obligation.update({ where: { id: o.id }, data: { lastReminderAt: now } });
    await tx.obligationEvent.create({ data: { obligationId: o.id, sessionId: o.sessionId, actorId: args.userId, type: "REMINDER_SENT" } });
    return { lastReminderAt: now };
  });
}
