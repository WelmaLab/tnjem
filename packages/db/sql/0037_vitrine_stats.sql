-- 0037 — vitrine statistics (Espace prof v2 · Phase 3).
--
-- "Vues · Clics · Abonnés" on Ma vitrine, for the last 30 days. Privacy-safe by
-- construction: this is an AGGREGATE table — one row per (tutor, day, source)
-- holding two counters. There is no visitor, no IP, no user agent, no session and
-- no timestamp finer than a day anywhere in it, and there is no column one could
-- be added to by accident: a counter row cannot identify anybody.
--
--   views   a load of the tutor's public page /{slug}
--   clicks  an arrival through a link the tutor shared (it carries utm_source),
--           on the profile or on one of their class pages
--
-- `source` is the utm_source the share sheet wrote ("whatsapp", "qr", …) or
-- "direct". It is ANALYTICS ONLY, never identity, and it is a closed vocabulary:
-- the API maps anything it does not know to "other", and the CHECK below refuses
-- anything that is not a short lowercase word, so the table cannot become a store
-- for arbitrary strings a visitor typed into a URL.
--
-- `day` is the Africa/Tunis calendar day (the API computes it in SQL).
--
-- IDEMPOTENT (IF NOT EXISTS / DO-block guards). Additive only.

BEGIN;

CREATE TABLE IF NOT EXISTS "vitrine_stats_daily" (
	"tutor_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "vitrine_stats_daily_pk" PRIMARY KEY ("tutor_id", "day", "source")
);

DO $$ BEGIN
 ALTER TABLE "vitrine_stats_daily" ADD CONSTRAINT "vitrine_stats_daily_tutor_id_tutors_id_fk"
   FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "vitrine_stats_daily" ADD CONSTRAINT "vitrine_stats_daily_source_word"
   CHECK ("source" ~ '^[a-z]{1,16}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "vitrine_stats_daily" ADD CONSTRAINT "vitrine_stats_daily_counts_nonneg"
   CHECK ("views" >= 0 AND "clicks" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
