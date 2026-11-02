-- =============================================================================
-- Phare — drop the one-review-per-month index. 2026-11-02. PART B of two
-- (A: 20261102000000_month_end_review_own_slot).
--
-- STATUS: WRITTEN — not applied.
--
-- APPLY ONLY AFTER phare.money runs the 2026-11-02 code (regenerate-plan
-- upserts on household_id,review_month,generated_by). The deployed code before
-- that upserts on (household_id, review_month), which only this index
-- satisfies: dropping it first breaks Regenerate.
--
-- After this, a month holds at most one 'cron' (month-end) and one 'manual'
-- (refresh) letter per household, enforced by
-- idx_conversations_review_month_writer (part A).
-- =============================================================================

DROP INDEX IF EXISTS idx_conversations_review_month_claim;

-- =============================================================================
-- VERIFY — run after applying. Read-only. Expected: both rows PASS.
-- =============================================================================
--
-- SELECT 'old one-per-month index gone' AS check_name,
--        CASE WHEN to_regclass('public.idx_conversations_review_month_claim') IS NULL THEN 'PASS' ELSE 'FAIL' END AS result
-- UNION ALL
-- SELECT 'per-writer index still there',
--        CASE WHEN to_regclass('public.idx_conversations_review_month_writer') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END;
