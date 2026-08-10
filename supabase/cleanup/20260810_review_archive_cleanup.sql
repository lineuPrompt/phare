-- =============================================================================
-- Phare — review archive cleanup. 2026-08-10.
--
-- NOT A MIGRATION. This is DATA, it is HOUSEHOLD-SCOPED, and it is destructive.
-- It lives outside supabase/migrations deliberately so no automated apply can
-- ever pick it up. Run it by hand, section by section, reading the counts.
--
-- SET THIS FIRST. Every statement below is scoped to it.
--   \set hh '00000000-0000-0000-0000-000000000000'
-- or replace :'hh' with your household id inline.
--
-- WHY EACH SECTION EXISTS
--
--   A. 22 unmonthed refreshes (yours). Under one-review-per-month they render
--      nowhere: they carry no review_month, and inferring one from created_at
--      would file a letter under a month it may not describe.
--
--   B. Duplicate onboarding letters (yours). save-plan writes one per plan
--      save, so re-uploading produced several. The EARLIEST is the cold-start
--      baseline and is kept; the rest have no home in the new model.
--
--   C. The mislabelled 2026-07 row (yours). Written before the service took a
--      reviewMonth parameter, so it is filed as July and its prose opens
--      "August 2026 brought in a combined household income of $12,466.80".
--      Deleting it lets the fixed path write a correct one.
--
--   D. OTHER HOUSEHOLDS — deliberately NOT the same treatment. Section D keeps
--      each household's NEWEST unmonthed refresh. The dashboard shows the
--      newest conversation of any kind, so deleting every unmonthed row from a
--      household that regenerated before the cron existed would drop them back
--      to their ONBOARDING letter — their oldest letter, presented as their
--      current review. The kept row is invisible in the archive and load-
--      bearing on the dashboard.
--
-- RUN ORDER: preview, then A–C, then D, then verify. Sections A–C are safe to
-- run inside one transaction; D is listed separately because it touches every
-- household and deserves its own read of the counts.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. PREVIEW — run this alone first. Changes nothing.
-- -----------------------------------------------------------------------------
SELECT 'A: unmonthed refreshes (delete all)' AS bucket, count(*) AS rows
  FROM conversations
 WHERE household_id = :'hh' AND type = 'monthly_review' AND review_month IS NULL
UNION ALL
SELECT 'B: onboarding letters (keep earliest, delete rest)',
       GREATEST(count(*) - 1, 0)
  FROM conversations
 WHERE household_id = :'hh' AND type = 'onboarding'
UNION ALL
SELECT 'C: mislabelled 2026-07 row', count(*)
  FROM conversations
 WHERE household_id = :'hh' AND review_month = '2026-07'
UNION ALL
SELECT 'KEEP: earliest onboarding (the starting plan)', count(*)
  FROM (SELECT 1 FROM conversations
         WHERE household_id = :'hh' AND type = 'onboarding'
         ORDER BY created_at ASC LIMIT 1) k;

-- Read the mislabelled row before deleting it, to confirm C is the right row:
SELECT review_month, created_at, left(messages->1->>'content', 160) AS opening
  FROM conversations
 WHERE household_id = :'hh' AND review_month = '2026-07';


-- -----------------------------------------------------------------------------
-- A + B + C — YOUR HOUSEHOLD ONLY.
-- -----------------------------------------------------------------------------
BEGIN;

-- A. Every unmonthed refresh.
DELETE FROM conversations
 WHERE household_id = :'hh'
   AND type = 'monthly_review'
   AND review_month IS NULL;

-- B. Onboarding letters except the earliest.
--    NOT NOT IN (...) with a subquery that could return NULL — an id set from
--    a LIMIT 1 is safe, but the anti-join form below cannot be tripped by one.
DELETE FROM conversations c
 WHERE c.household_id = :'hh'
   AND c.type = 'onboarding'
   AND c.id <> (
     SELECT id FROM conversations
      WHERE household_id = :'hh' AND type = 'onboarding'
      ORDER BY created_at ASC
      LIMIT 1
   );

-- C. The mislabelled July row.
DELETE FROM conversations
 WHERE household_id = :'hh'
   AND review_month = '2026-07';

-- Expect: exactly one onboarding row left, and no monthed rows at all.
SELECT type, review_month, generated_by, count(*)
  FROM conversations
 WHERE household_id = :'hh'
 GROUP BY 1, 2, 3
 ORDER BY 1, 2;

-- COMMIT;   -- uncomment once the counts above look right
ROLLBACK;    -- default: change nothing until you have read them


-- -----------------------------------------------------------------------------
-- D. EVERY OTHER HOUSEHOLD — keep the newest unmonthed refresh, delete the rest.
--
-- The kept row is what stops their dashboard falling back to the onboarding
-- letter. It is not rendered in the archive.
-- -----------------------------------------------------------------------------
BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY household_id ORDER BY created_at DESC) AS rn
    FROM conversations
   WHERE type = 'monthly_review'
     AND review_month IS NULL
     AND household_id <> :'hh'
)
DELETE FROM conversations
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Expect at most ONE unmonthed row per household.
SELECT household_id, count(*) AS unmonthed_remaining
  FROM conversations
 WHERE type = 'monthly_review' AND review_month IS NULL
 GROUP BY household_id
 ORDER BY unmonthed_remaining DESC;

-- COMMIT;
ROLLBACK;


-- =============================================================================
-- VERIFY — run after committing. Expect every row PASS.
-- =============================================================================
--
-- WITH checks AS (
--   SELECT 'your household has no unmonthed refreshes' AS check_name,
--          CASE WHEN NOT EXISTS (SELECT 1 FROM conversations
--                WHERE household_id = :'hh' AND type='monthly_review'
--                  AND review_month IS NULL)
--               THEN 'PASS' ELSE 'FAIL' END AS status
--   UNION ALL
--   SELECT 'your household has exactly one onboarding letter',
--          CASE WHEN (SELECT count(*) FROM conversations
--                WHERE household_id = :'hh' AND type='onboarding') = 1
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'the mislabelled 2026-07 row is gone',
--          CASE WHEN NOT EXISTS (SELECT 1 FROM conversations
--                WHERE household_id = :'hh' AND review_month = '2026-07')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'no household has more than one unmonthed refresh',
--          CASE WHEN NOT EXISTS (
--                SELECT 1 FROM conversations
--                 WHERE type='monthly_review' AND review_month IS NULL
--                 GROUP BY household_id HAVING count(*) > 1)
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'every household that had a review still has one to show',
--          CASE WHEN NOT EXISTS (
--                SELECT 1 FROM households h
--                 WHERE EXISTS (SELECT 1 FROM conversations c
--                                WHERE c.household_id = h.id)
--                   AND NOT EXISTS (SELECT 1 FROM conversations c
--                                    WHERE c.household_id = h.id))
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'one review per (household, month) still holds',
--          CASE WHEN NOT EXISTS (
--                SELECT 1 FROM conversations WHERE review_month IS NOT NULL
--                 GROUP BY household_id, review_month HAVING count(*) > 1)
--               THEN 'PASS' ELSE 'FAIL' END
-- )
-- SELECT * FROM checks ORDER BY status, check_name;
-- =============================================================================
