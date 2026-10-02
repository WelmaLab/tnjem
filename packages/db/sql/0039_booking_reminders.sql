-- 0039 — "sent" markers for booking reminders and the review prompt
-- (espace prof v2 · phase 7, lane pro).
--
-- POST /cron/reminders runs every few minutes and must send each email ONCE,
-- however often it runs and however two runs overlap. The marker IS the claim:
-- the job sets it with a conditional UPDATE … RETURNING before sending, so only
-- one run can win a given reminder, and puts the old value back if the send fails
-- (the next run retries while the reminder is still due).
--
--   bookings.reminder_24h_sent_at   the student's "tomorrow" reminder
--   bookings.reminder_1h_sent_at    the student's "in an hour" reminder
--   bookings.review_prompt_sent_at  the after-class review prompt (attended only)
--   classes.tutor_reminder_24h_sent_at / tutor_reminder_1h_sent_at
--                                   the tutor's reminders — one per class, not one
--                                   per booking
--
-- A MARKER OLDER THAN THE APPOINTMENT IS STALE. A reminder sent before the class
-- was moved (classes.rescheduled_at) or before the seat was re-booked
-- (bookings.created_at, reset on re-booking — A8) was about a time or a booking
-- that no longer exists, so the job treats it as unsent. No other code path has to
-- remember to clear these columns.
--
-- Nullable, no default, no back-fill: every existing row reads "not sent", and the
-- job's own windows (24 h / 1 h before the start, at most 7 days after the end for
-- the review prompt) keep it from mailing anyone about a class long past.
--
-- IDEMPOTENT. Additive only: five nullable columns, nothing rewritten.
--
-- ROLLBACK (manual):
--   ALTER TABLE "bookings" DROP COLUMN IF EXISTS "reminder_24h_sent_at";
--   ALTER TABLE "bookings" DROP COLUMN IF EXISTS "reminder_1h_sent_at";
--   ALTER TABLE "bookings" DROP COLUMN IF EXISTS "review_prompt_sent_at";
--   ALTER TABLE "classes" DROP COLUMN IF EXISTS "tutor_reminder_24h_sent_at";
--   ALTER TABLE "classes" DROP COLUMN IF EXISTS "tutor_reminder_1h_sent_at";

BEGIN;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" timestamptz;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reminder_1h_sent_at" timestamptz;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "review_prompt_sent_at" timestamptz;
ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "tutor_reminder_24h_sent_at" timestamptz;
ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "tutor_reminder_1h_sent_at" timestamptz;

COMMIT;
