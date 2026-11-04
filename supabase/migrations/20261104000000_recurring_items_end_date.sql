-- =============================================================================
-- Phare — an optional end date on a recurring rule. 2026-11-04.
--
-- STATUS: WRITTEN — not applied.
--
-- APPLY BEFORE phare.money runs the 2026-11-04 code: POST/PATCH/GET
-- /api/recurring read and write this column, and fail without it. (The daily
-- top-up reads the rule with '*' and treats a missing column as "no end date",
-- so the cron itself is safe either way.)
--
-- A rule with no end date keeps going: the daily cron continues it 12 months
-- ahead (src/lib/recurringTopUp.ts). With one, no occurrence is written after
-- it. Nullable, no default: every existing rule keeps going, as before.
-- Additive only; nothing is rewritten.
-- =============================================================================

ALTER TABLE recurring_items ADD COLUMN IF NOT EXISTS end_date date;

COMMENT ON COLUMN recurring_items.end_date IS
  'Last day an occurrence may fall on. NULL: the rule keeps going (the daily top-up continues it 12 months ahead).';

-- =============================================================================
-- VERIFY — run after applying. Read-only. Expected: every row PASS.
-- =============================================================================
--
-- SELECT 'end_date exists, type date, nullable' AS check_name,
--        CASE WHEN EXISTS (
--          SELECT 1 FROM information_schema.columns
--           WHERE table_schema = 'public' AND table_name = 'recurring_items'
--             AND column_name = 'end_date' AND data_type = 'date' AND is_nullable = 'YES'
--        ) THEN 'PASS' ELSE 'FAIL' END AS result
-- UNION ALL
-- SELECT 'no existing rule was given an end date',
--        CASE WHEN NOT EXISTS (SELECT 1 FROM recurring_items WHERE end_date IS NOT NULL)
--        THEN 'PASS' ELSE 'FAIL' END;
