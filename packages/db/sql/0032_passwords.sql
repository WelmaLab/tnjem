-- 0032 — passwords (espace prof v2 · phase 2).
--
-- Until now an account had no password at all: every sign-in was a one-time code
-- sent by e-mail. From here a password is created at sign-up, and sign-in works with
-- the password OR a code. Three nullable columns on profiles:
--
--   password_hash         argon2id, PHC string ("$argon2id$v=19$m=19456,t=2,p=1$…"),
--                         written ONLY by apps/api/src/lib/password.ts. NULL = this
--                         account has no password and signs in by code, as before.
--   password_set_at       when it was last set, changed or reset (shown on
--                         Réglages › Sécurité; NULL with the hash).
--   password_prompted_at  when a password-less account was ONCE offered
--                         « Crée un mot de passe (recommandé) » after a code sign-in.
--                         Set at the moment the offer is made, so it is made once.
--
-- Two CHECKs, both satisfied by every existing row (every hash is NULL):
--   * profiles_password_hash_argon2id — the column can only ever hold an argon2id
--     PHC string. Defence in depth for "never stored in plain text": a code path
--     that wrote a raw password here would fail at the database, not leak.
--   * profiles_purged_has_no_password — an erased account (0022) carries no password
--     hash, the same promise profiles_purged_has_no_identity makes for the e-mail.
--     packages/db/src/erasure.ts clears the three columns.
--
-- No OTP "purpose" column: a reset code is the same proof of mailbox ownership as a
-- sign-in code (same row, same 5-try budget, same cooldown). Only the e-mail's
-- wording changes, and that is chosen at send time.
--
-- Lockout state (5 failed passwords → 15 minutes, per account and per IP) lives in
-- the existing rate_limits table, keyed on an HMAC of the address (never the
-- address) and on the IP bucket. No new table.
--
-- IDEMPOTENT. Additive only.
--
-- ROLLBACK (manual):
--   ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_purged_has_no_password";
--   ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_password_hash_argon2id";
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "password_prompted_at";
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "password_set_at";
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "password_hash";

BEGIN;

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "password_set_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "password_prompted_at" timestamp with time zone;

DO $$
BEGIN
  ALTER TABLE "profiles"
    ADD CONSTRAINT "profiles_password_hash_argon2id"
    CHECK ("password_hash" IS NULL OR "password_hash" LIKE '$argon2id$%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "profiles"
    ADD CONSTRAINT "profiles_purged_has_no_password"
    CHECK ("purged_at" IS NULL OR "password_hash" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
