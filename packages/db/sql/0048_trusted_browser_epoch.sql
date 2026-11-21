-- 0048 — trusted-browser epoch (VULN-001 follow-up, security audit Nov 2026).
--
--   A successful sign-in gives the browser a signed « trusted browser » token
--   (apps/api/src/lib/trusted-browser.ts). Its MAC covers this number, so bumping
--   it retires every token issued before: « Se déconnecter partout » and a
--   password reset do. Plain logout does not (the token marks the device, not the
--   session). The token itself is stateless; nothing else is stored.
--
-- IDEMPOTENT. Additive only: one NOT NULL column with a default.
--
-- ROLLBACK (manual; every trusted browser becomes untrusted, nothing else):
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "trusted_browser_epoch";

BEGIN;

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "trusted_browser_epoch" integer DEFAULT 0 NOT NULL;

COMMIT;
