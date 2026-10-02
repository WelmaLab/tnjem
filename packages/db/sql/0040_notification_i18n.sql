-- 0040 — notifications in the reader's language.
--
-- A notification row now holds a message KEY and its JSON PARAMETERS, rendered when
-- it is read (@tnajem/shared/notification-messages): the bell in the page's
-- language, an SMS in the recipient's. title/body were the rendered French text;
-- they stay as the FALLBACK of rows written before this migration, and new rows
-- leave them null. A row must have one or the other.
--
-- Additive and idempotent. Re-running it is a no-op (every backfill below only
-- touches rows that still have no key).

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS msg_key text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS msg_params jsonb;
ALTER TABLE notifications ALTER COLUMN title DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN body DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_key_or_text') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_key_or_text
      CHECK (msg_key IS NOT NULL OR (title IS NOT NULL AND body IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_params_object') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_params_object
      CHECK (msg_params IS NULL OR jsonb_typeof(msg_params) = 'object');
  END IF;
END $$;

-- ── Existing rows ──────────────────────────────────────────────────────────────
-- Every row keeps its French title/body as the fallback. Rows whose text is fixed,
-- or holds one value that can be read back exactly (a class title, a reviewer's
-- note, a first name), also get their key, so they render in Arabic too. Rows whose
-- text embeds a date ("08 oct., 18:00", no year) or several values stay text-only:
-- the instant cannot be recovered, and a guessed parameter would be a false one.

UPDATE notifications SET msg_key = 'verificationApproved', msg_params = '{}'::jsonb
 WHERE msg_key IS NULL AND title = 'Profil vérifié ✅'
   AND body = 'Ton profil est validé. Ta page est en ligne et visible dans Explorer.';

UPDATE notifications SET msg_key = 'verificationChangeApprovedName', msg_params = '{}'::jsonb
 WHERE msg_key IS NULL AND title = 'Modification validée ✅'
   AND body = 'Ton nouveau nom est validé : il est maintenant affiché sur ta page.';

UPDATE notifications SET msg_key = 'verificationChangeApprovedDocs', msg_params = '{}'::jsonb
 WHERE msg_key IS NULL AND title = 'Modification validée ✅'
   AND body = 'Tes nouveaux documents sont validés. Ta page reste en ligne.';

UPDATE notifications
   SET msg_key = 'messageNew',
       msg_params = jsonb_build_object('classTitle', (regexp_match(body, '^Tu as un nouveau message à propos de « (.*) »\.$'))[1])
 WHERE msg_key IS NULL AND title = 'Nouveau message'
   AND body ~ '^Tu as un nouveau message à propos de « .* »\.$';

UPDATE notifications
   SET msg_key = 'seatFreed',
       msg_params = jsonb_build_object('classTitle', (regexp_match(body, '^Une place s''est libérée pour « (.*) »\. Elle est de nouveau disponible\.$'))[1])
 WHERE msg_key IS NULL AND title = 'Place libérée'
   AND body ~ '^Une place s''est libérée pour « .* »\. Elle est de nouveau disponible\.$';

UPDATE notifications
   SET msg_key = 'verificationRejected',
       msg_params = jsonb_build_object('note', (regexp_match(body, '^Ton dossier n''a pas été validé : (.*)\. Tu peux corriger et renvoyer\.$'))[1])
 WHERE msg_key IS NULL AND title = 'Dossier à compléter'
   AND body ~ '^Ton dossier n''a pas été validé : .*\. Tu peux corriger et renvoyer\.$';

UPDATE notifications
   SET msg_key = 'verificationChangeRejected',
       msg_params = jsonb_build_object('note', (regexp_match(body, '^Ta modification n''a pas été validée : (.*)\. Ta page reste en ligne telle qu''elle a été validée\.$'))[1])
 WHERE msg_key IS NULL AND title = 'Modification non validée'
   AND body ~ '^Ta modification n''a pas été validée : .*\. Ta page reste en ligne telle qu''elle a été validée\.$';

-- The follower's first name; "Un élève" (no name) and "Un compte supprimé" (erased,
-- packages/db/src/erasure.ts) are the two texts that were never a name.
UPDATE notifications
   SET msg_key = 'followNew',
       msg_params = CASE (regexp_match(body, '^(.*) te suit : il sera prévenu de tes nouvelles séances et fiches\.$'))[1]
                      WHEN 'Un élève' THEN '{}'::jsonb
                      WHEN 'Un compte supprimé' THEN '{"whoErased": true}'::jsonb
                      ELSE jsonb_build_object('who', (regexp_match(body, '^(.*) te suit : il sera prévenu de tes nouvelles séances et fiches\.$'))[1])
                    END
 WHERE msg_key IS NULL AND title = 'Nouvel abonné'
   AND body ~ '^.* te suit : il sera prévenu de tes nouvelles séances et fiches\.$';
