-- 0034 — monthly offers and student subscriptions (Espace prof v2 · Phase 5 A).
--
-- NOT the tutor's plan. `subscriptions` (0017) is which Tnajem plan a TUTOR is on;
-- this is a STUDENT subscribing to a tutor's monthly offer ("4 séances / mois pour
-- 120 TND"). Different tables, different words: tutor_offers, student_subscriptions.
--
-- PAYMENTS ARE OFF. The student pays the tutor outside Tnajem; the tutor confirms
-- each month by hand ("Confirmer (paiement reçu hors Tnajem)"). Nothing here
-- implies a debt, and nothing charges anyone. The model is ready for online
-- payment to plug in later without a rewrite:
--   price_tnd          the monthly price SHOWN when the student asked (after any
--                      promotion — 0035 adds promotion_id), kept on the row: an
--                      offer edited later must not rewrite what was agreed;
--   sessions_per_month the quota agreed, same reason;
--   payments_enabled   what was true when the row was written — the cancellation
--                      ledger's convention (0009), so a future reader can tell an
--                      offline-confirmed month from a paid one.
--
-- STATES: requested → active (confirmed: one month from confirmation) → renewed
-- (period_end + 1 month), or paused / cancelled / expired (the nightly job, past
-- period_end). AT MOST ONE LIVE (requested | active | paused) PER STUDENT PER TUTOR —
-- a partial unique index, the only correct place for that rule.
--
-- tutor_offers: at most 3 non-archived per tutor (the API, under an advisory lock),
-- price > 0 and 1–31 sessions (CHECKs here, Zod in packages/shared too). An offer
-- that has been subscribed to is ARCHIVED, never deleted: subscriptions point at it.
--
-- bookings.subscription_id (contract C7): set when a subscriber's booking is covered
-- by the subscription (the seat counts against sessions_per_month). NULL for every
-- other booking. SET NULL so a subscription can never take a booking with it.
--
-- IDEMPOTENT throughout. Additive only.

BEGIN;

DO $$
BEGIN
  CREATE TYPE "public"."student_subscription_status" AS ENUM('requested', 'active', 'paused', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tutor_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"kind" text DEFAULT 'monthly' NOT NULL,
	"title" text NOT NULL,
	"sessions_per_month" integer NOT NULL,
	"price_tnd_per_month" numeric(7, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "tutor_offers" ADD CONSTRAINT "tutor_offers_tutor_id_tutors_id_fk"
   FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "tutor_offers" ADD CONSTRAINT "tutor_offers_kind_monthly" CHECK ("kind" = 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "tutor_offers" ADD CONSTRAINT "tutor_offers_sessions_1_31" CHECK ("sessions_per_month" BETWEEN 1 AND 31);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "tutor_offers" ADD CONSTRAINT "tutor_offers_price_positive" CHECK ("price_tnd_per_month" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "tutor_offers_tutor_id_created_at_idx" ON "tutor_offers" USING btree ("tutor_id", "created_at");

CREATE TABLE IF NOT EXISTS "student_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"status" "student_subscription_status" DEFAULT 'requested' NOT NULL,
	"sessions_per_month" integer NOT NULL,
	"price_tnd" numeric(7, 2) NOT NULL,
	"payments_enabled" boolean DEFAULT false NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"renewed_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reminder_sent_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_offer_id_tutor_offers_id_fk"
   FOREIGN KEY ("offer_id") REFERENCES "public"."tutor_offers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_tutor_id_tutors_id_fk"
   FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_student_profile_id_profiles_id_fk"
   FOREIGN KEY ("student_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_sessions_1_31" CHECK ("sessions_per_month" BETWEEN 1 AND 31);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_price_nonneg" CHECK ("price_tnd" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A subscription that has started has a period, and the period runs forwards.
DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_period_when_started"
   CHECK (("status" = 'requested' OR "confirmed_at" IS NULL OR ("period_start" IS NOT NULL AND "period_end" IS NOT NULL))
          AND ("period_end" IS NULL OR "period_start" IS NULL OR "period_end" > "period_start"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "student_subscriptions_one_live_per_tutor"
  ON "student_subscriptions" ("tutor_id", "student_profile_id")
  WHERE "status" IN ('requested', 'active', 'paused');
CREATE INDEX IF NOT EXISTS "student_subscriptions_tutor_id_status_idx" ON "student_subscriptions" USING btree ("tutor_id", "status");
CREATE INDEX IF NOT EXISTS "student_subscriptions_student_profile_id_idx" ON "student_subscriptions" USING btree ("student_profile_id");
-- The nightly expiry/reminder sweep: status + period_end.
CREATE INDEX IF NOT EXISTS "student_subscriptions_status_period_end_idx" ON "student_subscriptions" USING btree ("status", "period_end");

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "subscription_id" uuid;

DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_subscription_id_student_subscriptions_id_fk"
   FOREIGN KEY ("subscription_id") REFERENCES "public"."student_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_subscription_id_idx" ON "bookings" USING btree ("subscription_id");

COMMIT;
