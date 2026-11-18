-- 0043 — a test flag on tutors (december-sprint · lane A, D11).
--
--   tutors.is_test
--     true = an account used for live tests (e.g. the founder's walid-tester).
--     A test tutor is absent from every public LIST (Explore and its search, the
--     home tutor card, the sitemap) and its storefront and class pages carry
--     noindex, but its direct links keep working so live tests stay possible.
--     Set by an admin on /admin/accounts. Nothing else writes it.
--
-- IDEMPOTENT. Additive only: one NOT NULL column with a constant default, so no
-- existing row changes meaning (every current tutor is a non-test tutor).
--
-- ROLLBACK (manual, loses only the flags):
--   ALTER TABLE "tutors" DROP COLUMN IF EXISTS "is_test";

ALTER TABLE "tutors" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
