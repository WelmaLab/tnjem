-- 0046 — admin is a database fact, and a phone is an identity only once proven
-- (security audit VULN-006).
--
--   profiles.admin_granted_at
--     NOT NULL = this account is an admin, since then. The ONE source of admin:
--     requireAdmin (apps/api/src/lib/admin.ts) and GET /me read it, nothing else.
--     It used to be the ADMIN_EMAILS / ADMIN_PHONES env allow-list matched against
--     profiles.email / profiles.phone, and profiles.phone is a field the user types
--     — so under OTP_CHANNEL=sms typing the admin's number made you an admin.
--     Written only by the operator CLI (npm run admin:grant / admin:revoke,
--     packages/db/bin/admin.ts), which also writes an admin_actions row.
--
--   profiles.phone_verified_at
--     NOT NULL = the number in profiles.phone was proven by an SMS code at sign-in
--     (OTP_CHANNEL=sms). A number typed on the profile or storefront form is
--     contact data and stays NULL here; changing the number clears it. Sign-in,
--     « Mot de passe oublié » and account-status by phone match a VERIFIED number
--     only.
--
-- IDEMPOTENT. Additive only: two nullable columns, no backfill. Every existing
-- account starts as a non-admin with an unverified phone — production signs in by
-- e-mail, so no existing phone was ever proven. The founder grants their own
-- account once after deploy (DEPLOY.md, « Admin accounts »).
--
-- ROLLBACK (manual; loses the grants, admin then needs the old env allow-list code):
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "admin_granted_at";
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "phone_verified_at";

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "admin_granted_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
