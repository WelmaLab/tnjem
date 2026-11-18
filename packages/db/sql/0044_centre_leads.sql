-- 0044 — leads from the centre landing page (december-sprint · lane B, D13).
--
--   One row per form sent on /pour-les-centres. Personal data (a name and a phone
--   number): read, changed and exported ONLY through the API behind requireAdmin.
--   The raw IP address is NOT stored; the rate limiter keys on it in memory and in
--   rate_limits, as for every other public form.
--
--   levels   the levels taught, as @tnajem/shared LEVEL_CODES-style codes (text[]).
--   status   new | contacted | won | lost (CHECK). Default new.
--   utm_* / referrer / page / locale   first-party attribution, captured on landing.
--
-- RETENTION: no purge is built yet (LEGAL-REVIEW: CENTRE_LEAD_RETENTION_DAYS in packages/shared/src/legal.ts).
--
-- IDEMPOTENT throughout. Additive only.
--
-- ROLLBACK (manual, loses every lead):
--   DROP TABLE IF EXISTS "centre_leads";

BEGIN;

CREATE TABLE IF NOT EXISTS "centre_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"centre_name" text NOT NULL,
	"city" text NOT NULL,
	"phone" text NOT NULL,
	"teachers_count" integer,
	"levels" text[] DEFAULT '{}'::text[] NOT NULL,
	"message" text,
	"locale" text NOT NULL,
	"page" text NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"referrer" text,
	"status" text DEFAULT 'new' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "centre_leads" ADD CONSTRAINT "centre_leads_status_known" CHECK ("status" IN ('new', 'contacted', 'won', 'lost'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "centre_leads" ADD CONSTRAINT "centre_leads_locale_known" CHECK ("locale" IN ('fr', 'ar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "centre_leads_created_at_idx" ON "centre_leads" USING btree ("created_at");

COMMIT;
