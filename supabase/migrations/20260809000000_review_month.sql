-- =============================================================================
-- Phare — give a review the month it covers. 2026-08-06.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
--
-- Step 1 of monthly review delivery. One column, one partial unique index.
--
-- THE PROBLEM THIS EXISTS FOR: nothing generates a review on a schedule. Only
-- save-plan (once, at onboarding) and regenerate-plan (the manual button) ever
-- write one. The dashboard then shows `created_at DESC LIMIT 1`, so a household
-- that onboarded in August and never pressed the button is still shown their
-- August onboarding letter in November — presented as their monthly review,
-- describing a month that ended three months ago.
--
-- The fix is generation, not selection. This column is what makes the
-- generation idempotent and what lets the card label the letter honestly.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The month a review COVERS, distinct from when it was written.
--
-- NULL is a meaningful value here, not missing data:
--
--   onboarding reviews   → NULL. The letter narrates the plan at signup, before
--                          any month has closed. Stamping it '2026-08' would
--                          assert it reviews August, which the text does not do.
--
--   manual regenerations → NULL. An ad-hoc refresh, not the canonical monthly
--                          letter, and deliberately outside the uniqueness claim
--                          so pressing Regenerate never collides with the cron.
--
--   scheduled reviews    → 'YYYY-MM' of the COMPLETED month being reviewed.
--
-- No backfill: every existing row is one of the first two kinds and correctly
-- reads NULL.
-- -----------------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS review_month text;

-- Format guard. 'YYYY-MM' only — a date, a month name, or a full timestamp here
-- would silently break both the uniqueness claim and the label.
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_review_month_format;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_review_month_format
  CHECK (review_month IS NULL OR review_month ~ '^\d{4}-\d{2}$');


-- -----------------------------------------------------------------------------
-- 2. THE IDEMPOTENCY CLAIM.
--
-- Vercel retries a cron on any non-2xx, and the work behind this is the most
-- expensive prompt in the app. A retry that regenerates costs a second paid AI
-- call and (once step 2 ships) sends a second email for the same month.
--
-- So the generator INSERTS FIRST and treats a unique violation as "another run
-- already claimed this month, stop" — the insert IS the lock. Exactly the shape
-- stripe_webhook_events uses for the same reason: no read-then-write window to
-- lose, no advisory locks, nothing held in memory that dies on deploy.
--
-- PARTIAL, on purpose. Onboarding rows and manual regenerations all carry NULL
-- and must not compete for a slot with each other or with the scheduled review.
-- (Postgres already treats NULLs as distinct in a plain unique index, but
-- writing the predicate makes the intent explicit and keeps the index to only
-- the rows that matter.)
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_review_month_claim
  ON conversations (household_id, review_month)
  WHERE review_month IS NOT NULL;

-- The cron's own lookup: "does this household already have a review for month
-- M?", asked once per eligible household per hour.
CREATE INDEX IF NOT EXISTS idx_conversations_household_review_month
  ON conversations (household_id, review_month)
  WHERE review_month IS NOT NULL;

-- =============================================================================
-- VERIFY — run after applying. Expect every row PASS.
-- =============================================================================
--
-- WITH checks AS (
--   SELECT 'conversations.review_month (text, nullable)' AS check_name,
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='conversations'
--                  AND column_name='review_month'
--                  AND data_type='text' AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END AS status
--   UNION ALL
--   SELECT 'YYYY-MM format CHECK present',
--          CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
--                WHERE conname='conversations_review_month_format')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'partial UNIQUE index is the idempotency claim',
--          CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
--                WHERE schemaname='public'
--                  AND indexname='idx_conversations_review_month_claim'
--                  AND indexdef ILIKE '%UNIQUE%'
--                  AND indexdef ILIKE '%review_month IS NOT NULL%')
--               THEN 'PASS' ELSE 'FAIL — without UNIQUE a retried cron double-generates' END
--   UNION ALL
--   SELECT 'lookup index present',
--          CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
--                  AND indexname='idx_conversations_household_review_month')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'every EXISTING review still reads NULL (no backfill happened)',
--          CASE WHEN NOT EXISTS (SELECT 1 FROM conversations
--                WHERE review_month IS NOT NULL)
--               THEN 'PASS' ELSE 'FAIL — something stamped a month it cannot justify' END
-- )
-- SELECT * FROM checks ORDER BY status, check_name;
--
-- -- Your existing rows, and what they are (expect all review_month NULL):
-- SELECT type, review_month, count(*) AS rows,
--        min(created_at)::date AS earliest, max(created_at)::date AS latest
--   FROM conversations
--  GROUP BY type, review_month
--  ORDER BY type;
--
-- -- Prove the claim actually blocks a double-generate (rolls back, changes
-- -- nothing). The second INSERT must raise a unique violation:
-- --   BEGIN;
-- --   INSERT INTO conversations (household_id, user_id, type, messages, review_month)
-- --   VALUES ('<your household id>', NULL, 'monthly_review', '[]'::jsonb, '2099-01');
-- --   INSERT INTO conversations (household_id, user_id, type, messages, review_month)
-- --   VALUES ('<your household id>', NULL, 'monthly_review', '[]'::jsonb, '2099-01');
-- --   ROLLBACK;
-- =============================================================================
