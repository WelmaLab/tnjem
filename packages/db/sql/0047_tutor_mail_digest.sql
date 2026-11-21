-- 0047 — tutor booking-mail digest and collapsible notifications (VULN-002).
--
--   A book → cancel loop mailed and notified the tutor on every event. Two
--   additive pieces stop it (apps/api/src/lib/tutor-mail-digest.ts):
--
--   tutor_mail_digest
--     One row per booking / cancellation event bound for a TUTOR's inbox.
--     mailed_at set   → it went out (immediate = true: on its own, at once;
--                       immediate = false: inside a digest).
--     mailed_at null  → queued: the tutor was already mailed inside the current
--                       window, so it waits for ONE digest, sent by /cron/reminders
--                       (or by the tutor's next event) when the window closes.
--     Rows are short-lived: the flush deletes rows mailed more than 7 days ago.
--     No name and no address is stored; the digest reads them at send time.
--
--   notifications.collapse_key
--     Optional. When set, a new notification with the same (profile_id,
--     collapse_key) inside the caller's window UPDATES the existing row instead
--     of inserting one more (repeated book/cancel of one class by one student).
--
-- IDEMPOTENT throughout. Additive only: a new table, a nullable column, indexes.
--
-- ROLLBACK (manual, loses queued digest events):
--   DROP TABLE IF EXISTS "tutor_mail_digest";
--   DROP INDEX IF EXISTS "notifications_profile_id_collapse_key_idx";
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "collapse_key";

BEGIN;

CREATE TABLE IF NOT EXISTS "tutor_mail_digest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
	"student_id" uuid REFERENCES "profiles"("id") ON DELETE CASCADE,
	"class_id" uuid NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
	"event" text NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"immediate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mailed_at" timestamp with time zone
);

DO $$ BEGIN
 ALTER TABLE "tutor_mail_digest" ADD CONSTRAINT "tutor_mail_digest_event_known" CHECK ("event" IN ('booked', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The window check (max mailed_at per tutor) and the queue (mailed_at is null).
CREATE INDEX IF NOT EXISTS "tutor_mail_digest_tutor_mailed_idx" ON "tutor_mail_digest" ("tutor_profile_id", "mailed_at");

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "collapse_key" text;

CREATE INDEX IF NOT EXISTS "notifications_profile_id_collapse_key_idx"
	ON "notifications" ("profile_id", "collapse_key") WHERE "collapse_key" IS NOT NULL;

COMMIT;
