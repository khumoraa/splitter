-- CreateEnum
CREATE TYPE "public"."ObligationStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID_PENDING_CONFIRMATION', 'PAID', 'FORGIVEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "public"."Obligation" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "debtorId" INTEGER NOT NULL,
    "creditorId" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "public"."ObligationStatus" NOT NULL DEFAULT 'UNPAID',
    "confirmedMinor" INTEGER NOT NULL DEFAULT 0,
    "pendingMinor" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ObligationPayment" (
    "id" SERIAL NOT NULL,
    "obligationId" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "method" "public"."PaymentMethod" NOT NULL,
    "note" TEXT,
    "status" "public"."PaymentStatus" NOT NULL,
    "recordedById" INTEGER NOT NULL,
    "resolvedById" INTEGER,
    "rejectionReason" TEXT,
    "idemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ObligationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ObligationEvent" (
    "id" SERIAL NOT NULL,
    "obligationId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "paymentId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Obligation_debtorId_status_idx" ON "public"."Obligation"("debtorId", "status");

-- CreateIndex
CREATE INDEX "Obligation_creditorId_status_idx" ON "public"."Obligation"("creditorId", "status");

-- CreateIndex
CREATE INDEX "Obligation_sessionId_idx" ON "public"."Obligation"("sessionId");

-- CreateIndex
CREATE INDEX "ObligationPayment_obligationId_idx" ON "public"."ObligationPayment"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationPayment_obligationId_recordedById_idemKey_key" ON "public"."ObligationPayment"("obligationId", "recordedById", "idemKey");

-- CreateIndex
CREATE INDEX "ObligationEvent_obligationId_createdAt_idx" ON "public"."ObligationEvent"("obligationId", "createdAt");

-- CreateIndex
CREATE INDEX "ObligationEvent_sessionId_idx" ON "public"."ObligationEvent"("sessionId");

-- AddForeignKey
ALTER TABLE "public"."Obligation" ADD CONSTRAINT "Obligation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Obligation" ADD CONSTRAINT "Obligation_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Obligation" ADD CONSTRAINT "Obligation_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObligationPayment" ADD CONSTRAINT "ObligationPayment_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."Obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObligationPayment" ADD CONSTRAINT "ObligationPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObligationPayment" ADD CONSTRAINT "ObligationPayment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObligationEvent" ADD CONSTRAINT "ObligationEvent_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."Obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObligationEvent" ADD CONSTRAINT "ObligationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- hand-written parts

-- Money invariants, enforced by the database too: a debt is positive, and recorded payments never exceed it.
ALTER TABLE "public"."Obligation" ADD CONSTRAINT "Obligation_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "public"."Obligation" ADD CONSTRAINT "Obligation_paid_within_amount"
  CHECK ("confirmedMinor" >= 0 AND "pendingMinor" >= 0 AND "confirmedMinor" + "pendingMinor" <= "amountMinor");
ALTER TABLE "public"."ObligationPayment" ADD CONSTRAINT "ObligationPayment_amount_positive" CHECK ("amountMinor" > 0);

-- One live (not cancelled) obligation per bill and debtor.
CREATE UNIQUE INDEX "Obligation_live_per_debtor_key" ON "public"."Obligation"("sessionId", "debtorId") WHERE "status" <> 'CANCELLED';

-- The audit log is append-only: its content can never be edited. The only allowed change is replacing the actor
-- with the "Deleted user" placeholder when an account is deleted (privacy), which keeps every other column.
CREATE FUNCTION "public"."obligation_event_append_only"() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."obligationId", NEW."sessionId", NEW."type", NEW."amountMinor", NEW."paymentId", NEW."note", NEW."createdAt")
     IS DISTINCT FROM (OLD."id", OLD."obligationId", OLD."sessionId", OLD."type", OLD."amountMinor", OLD."paymentId", OLD."note", OLD."createdAt") THEN
    RAISE EXCEPTION 'ObligationEvent is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ObligationEvent_append_only" BEFORE UPDATE ON "public"."ObligationEvent"
  FOR EACH ROW EXECUTE FUNCTION "public"."obligation_event_append_only"();

-- Data migration: bills finalized before this feature get UNPAID obligations (payer = bill creator, as before).
-- Shares come from the stored history JSON, rounded to the currency's minor unit; unknown users and zero shares are skipped.
WITH shares AS (
  SELECT h."sessionId", h."creatorId", h."currency", h."finalizedAt", u."id" AS "userId",
         SUM(ROUND(
           CASE WHEN jsonb_typeof(p.elem->'amountOwed') = 'number' THEN (p.elem->>'amountOwed')::numeric ELSE 0 END
           * CASE WHEN upper(h."currency") IN ('JPY','KRW','VND','UZS','IDR','CLP','ISK','HUF') THEN 1 ELSE 100 END
         ))::int AS "minor"
  FROM "public"."SessionHistoryEntry" h
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(h."payload"->'totals'->'byParticipant') = 'array' THEN h."payload"->'totals'->'byParticipant' ELSE '[]'::jsonb END
  ) AS p(elem)
  JOIN "public"."User" u ON u."uniqueId" = p.elem->>'uniqueId'
  WHERE u."id" <> h."creatorId"
  GROUP BY h."sessionId", h."creatorId", h."currency", h."finalizedAt", u."id"
),
inserted AS (
  INSERT INTO "public"."Obligation" ("sessionId", "debtorId", "creditorId", "amountMinor", "currency", "status", "createdAt", "updatedAt")
  SELECT "sessionId",
         CASE WHEN "minor" > 0 THEN "userId" ELSE "creatorId" END,
         CASE WHEN "minor" > 0 THEN "creatorId" ELSE "userId" END,
         ABS("minor"), "currency", 'UNPAID', "finalizedAt", CURRENT_TIMESTAMP
  FROM shares WHERE "minor" <> 0
  RETURNING "id", "sessionId", "creditorId", "debtorId", "amountMinor", "createdAt"
)
INSERT INTO "public"."ObligationEvent" ("obligationId", "sessionId", "actorId", "type", "amountMinor", "note", "createdAt")
SELECT i."id", i."sessionId", s."creatorId", 'CREATED', i."amountMinor", 'imported from a bill finalized before payment tracking', i."createdAt"
FROM inserted i JOIN "public"."Session" s ON s."id" = i."sessionId";
