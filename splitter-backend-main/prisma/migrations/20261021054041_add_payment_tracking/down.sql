-- Rollback of add_payment_tracking (removes only the new objects; bills and history are untouched)
DROP TRIGGER IF EXISTS "ObligationEvent_append_only" ON "public"."ObligationEvent";
DROP FUNCTION IF EXISTS "public"."obligation_event_append_only"();
DROP TABLE IF EXISTS "public"."ObligationEvent";
DROP TABLE IF EXISTS "public"."ObligationPayment";
DROP TABLE IF EXISTS "public"."Obligation";
DROP TYPE IF EXISTS "public"."PaymentMethod";
DROP TYPE IF EXISTS "public"."PaymentStatus";
DROP TYPE IF EXISTS "public"."ObligationStatus";
