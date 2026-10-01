-- 0036 — espace prof v2 · phase 1 (shell): setup progress + message read marks.
--
-- tutors.link_shared_at
--   The home checklist has five steps: page created, verification, photo, first
--   class, link shared. The first four are already facts in the database; "link
--   shared" was not. It is set ONCE, the first time the owner copies or shares their
--   own link (POST /tutor/link-shared, idempotent), and never cleared. NULL = never.
--   It records that the button was used, not that anybody received the link.
--
-- message_threads.tutor_read_at / student_read_at
--   The shell's messages icon carries an unread count, and there was no read state
--   anywhere: a message had no "seen" mark. One timestamp per side of the thread —
--   "this participant last opened the conversation at" — set when they open it
--   (GET /threads/:id). Unread = messages from the OTHER side created after it.
--   Per side rather than per message: a thread is read as a whole, and a row per
--   message per reader would grow with every message for no gain. NULL = never
--   opened, so every message from the other side counts.
--
-- IDEMPOTENT. Additive only: nullable columns, no default, no backfill. Existing
-- threads start "never opened", so a tutor who already has messages sees them
-- counted once, until they open the thread — the honest answer, since we cannot
-- know what they read before this column existed.
--
-- MANUAL ROLLBACK (loses only the marks):
--   ALTER TABLE "tutors" DROP COLUMN IF EXISTS "link_shared_at";
--   ALTER TABLE "message_threads" DROP COLUMN IF EXISTS "tutor_read_at", DROP COLUMN IF EXISTS "student_read_at";

BEGIN;

ALTER TABLE "tutors" ADD COLUMN IF NOT EXISTS "link_shared_at" timestamp with time zone;

ALTER TABLE "message_threads" ADD COLUMN IF NOT EXISTS "tutor_read_at" timestamp with time zone;
ALTER TABLE "message_threads" ADD COLUMN IF NOT EXISTS "student_read_at" timestamp with time zone;

COMMIT;
