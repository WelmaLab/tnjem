-- 0041 — live-fixes-1 · B: « Mes fiches » — a pack and its file are ONE fiche.
--
-- packs.material_id
--   « Nouvelle fiche » (/dashboard/new-pack) uploads the file as a materials row
--   (visibility 'students': the tutor and their enrolled students, decided by
--   canRead() in apps/api) and then creates the pack. Nothing tied the two, so Mes
--   fiches listed every fiche twice — once with its price, once with its file — and
--   removing one left the other behind. This column is the tie: the pack is what the
--   tutor's page lists, the material is what an enrolled student opens.
--   ON DELETE SET NULL: a removed file leaves the listed fiche, without a file.
--
-- Backfill: a pack created through that flow has, a moment before it, a file
-- material of the same tutor with the same title. Linked only when there is exactly
-- one such candidate (same tutor and title, a 'students' file created in the 10
-- minutes before the pack, not removed, not already linked) — anything ambiguous is
-- left as it was: two separate rows, as before.
--
-- IDEMPOTENT. Additive only. Re-running it changes nothing (the backfill only
-- touches packs that still have no material).
--
-- MANUAL ROLLBACK (loses only the link):
--   ALTER TABLE "packs" DROP COLUMN IF EXISTS "material_id";

ALTER TABLE "packs" ADD COLUMN IF NOT EXISTS "material_id" uuid
  REFERENCES "materials"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "packs_material_id_idx" ON "packs" ("material_id");

WITH candidates AS (
  SELECT p2.id AS pack_id, m.id AS material_id
    FROM "packs" p2
    JOIN "materials" m
      ON m.tutor_id = p2.tutor_id
     AND m.title = p2.title
     AND m.kind = 'file'
     AND m.visibility = 'students'
     AND m.removed_at IS NULL
     AND m.created_at <= p2.created_at
     AND m.created_at > p2.created_at - interval '10 minutes'
     AND NOT EXISTS (SELECT 1 FROM "packs" o WHERE o.material_id = m.id)
   WHERE p2.material_id IS NULL
), unique_pairs AS (
  -- one candidate for the pack AND one pack for the material, or nothing
  SELECT c.pack_id, c.material_id
    FROM candidates c
   WHERE (SELECT count(*) FROM candidates x WHERE x.pack_id = c.pack_id) = 1
     AND (SELECT count(*) FROM candidates y WHERE y.material_id = c.material_id) = 1
)
UPDATE "packs" p
   SET "material_id" = u.material_id
  FROM unique_pairs u
 WHERE p.id = u.pack_id
   AND p.material_id IS NULL;
