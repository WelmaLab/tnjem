-- 0033 — students follow a teacher, and e-mail preferences (Espace prof v2 · Phase 4).
--
-- tutor_follows: "Suivre / Abonné ✓". One row per (student, tutor) — the primary
-- key IS the spec's unique(student, tutor), so pressing Suivre twice is one follow.
-- Unfollowing DELETES the row: who follows whom is personal data, and a record of
-- a follow the student withdrew is not ours to keep.
--
--   notified_through  the digest cursor: the follower has been told about this
--                     tutor's classes and packs published up to this instant. A
--                     new follow starts at now(), so following never mails out a
--                     tutor's whole back catalogue.
--
-- notification_prefs (contract C5): one row per profile, created on first save.
-- NO ROW MEANS EVERYTHING ON — that is the default every account had before this
-- table existed, and a missing row must never silently mean "unsubscribed".
-- packages/db/src/notification-prefs.ts::wantsEmail() is the one reader.
--
-- follow_digests: when a profile last received the followers digest, so the
-- nightly job sends AT MOST ONE A DAY even if it runs twice.
--
-- IDEMPOTENT (IF NOT EXISTS / DO-block guards). Additive only. No grants: the
-- default privileges give tnajem_app what it needs.

BEGIN;

CREATE TABLE IF NOT EXISTS "tutor_follows" (
	"student_profile_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_through" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_follows_student_tutor_pk" PRIMARY KEY ("student_profile_id", "tutor_id")
);

DO $$ BEGIN
 ALTER TABLE "tutor_follows" ADD CONSTRAINT "tutor_follows_student_profile_id_profiles_id_fk"
   FOREIGN KEY ("student_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "tutor_follows" ADD CONSTRAINT "tutor_follows_tutor_id_tutors_id_fk"
   FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- "my followers, newest first" and the follower count; the PK serves the student side.
CREATE INDEX IF NOT EXISTS "tutor_follows_tutor_id_created_at_idx" ON "tutor_follows" USING btree ("tutor_id", "created_at");

CREATE TABLE IF NOT EXISTS "notification_prefs" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"followers" boolean DEFAULT true NOT NULL,
	"bookings" boolean DEFAULT true NOT NULL,
	"messages" boolean DEFAULT true NOT NULL,
	"reminders" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_profile_id_profiles_id_fk"
   FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "follow_digests" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "follow_digests" ADD CONSTRAINT "follow_digests_profile_id_profiles_id_fk"
   FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
