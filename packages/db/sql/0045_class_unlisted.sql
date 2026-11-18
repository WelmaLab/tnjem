-- 0045 — unlisted classes (december-sprint · lane E, D18).
--
--   classes.unlisted
--     true = bookable through its direct link and its QR code, but absent from
--     Explore, search, the sitemap and the public list on the tutor's storefront.
--     A switch in the tutor's class form. A centre uses it for its own pupils.
--
-- IDEMPOTENT. Additive only: NOT NULL with a constant default, every existing
-- class stays listed.
--
-- ROLLBACK (manual, every class becomes listed again):
--   ALTER TABLE "classes" DROP COLUMN IF EXISTS "unlisted";

ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "unlisted" boolean DEFAULT false NOT NULL;
