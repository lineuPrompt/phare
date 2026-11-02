-- =============================================================================
-- Phare — the month-end review gets its own slot, beside a mid-month refresh.
-- 2026-11-02. PART A of two (B: 20261102010000_drop_one_review_per_month_index).
--
-- STATUS: WRITTEN — not applied. Lineu applies it in the SQL Editor.
--
-- THE BUG. conversations allowed ONE monthly letter per household per month
-- (idx_conversations_review_month_claim on household_id, review_month). A
-- household that pressed Regenerate mid-month held that month's only slot with
-- a 'manual' letter, so on the 1st the cron could not write the month-end
-- letter beside it: it took the manual row over (relabel to 'cron', generate,
-- overwrite). If that generation failed, the row went back to 'manual'; if
-- the run was cut off mid-takeover, the row stayed 'cron' still holding the
-- mid-month text, and counted as done forever. Either way the household kept
-- its mid-month draft as the month's review (Lineu, October 2026: draft of 13
-- October, no month-end letter on 1 November).
--
-- THE CHANGE (Lineu: keep both). One letter per household, month AND writer:
-- the cron's month-end letter (generated_by 'cron') and the household's own
-- refresh ('manual') each have their own row. The Reviews page shows the
-- month-end letter, with the refresh beneath it.
--
-- WHY TWO MIGRATIONS. The code's upserts and claims name the unique index
-- they rely on. With BOTH indexes present, the deployed code (2 columns) and
-- the new code (3 columns) each find theirs, so nothing breaks in between:
--   1. apply THIS (A): adds the 3-column index, keeps the old one;
--   2. deploy the code;
--   3. once phare.money runs it, apply B: drops the old index. Until then a
--      month-end letter beside a refresh is refused by the old index, which
--      the cron reports as claimed_by_other and retries the next day.
--
-- ALSO IN A:
--   * generated_by must be set on every monthed row (the 3-column index treats
--     NULLs as distinct, so a NULL would escape it). 20260810 backfilled every
--     existing row and both writers always set it; the CHECK makes it hold.
--   * REPAIR: a 'cron' row created before its own month had ended can only be
--     a takeover that was cut off (the cron only ever writes the month that
--     has ended) or a pre-20260810 refresh the backfill labelled 'cron'. Both
--     hold mid-month text: they become 'manual', so the month is due again
--     and the cron writes the real month-end letter (days 1-7, reviewSchedule).
--     Compared in each household's own timezone, never UTC.
-- =============================================================================

-- BEFORE (run on its own first; read-only). The rows the repair will change.
--
-- SELECT c.id, c.household_id, c.review_month, c.generated_by, c.created_at, h.timezone
--   FROM conversations c
--   JOIN households h ON h.id = c.household_id
--  WHERE c.review_month IS NOT NULL
--    AND c.generated_by = 'cron'
--    AND c.created_at < ((to_date(c.review_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp
--                        AT TIME ZONE h.timezone);

BEGIN;

-- Expected rows: as many as BEFORE returned (0 or a few; 2be22642's October
-- only if its 1 November takeover was cut off).
UPDATE conversations c
   SET generated_by = 'manual'
  FROM households h
 WHERE h.id = c.household_id
   AND c.review_month IS NOT NULL
   AND c.generated_by = 'cron'
   AND c.created_at < ((to_date(c.review_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp
                       AT TIME ZONE h.timezone);

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_monthed_has_writer;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_monthed_has_writer
  CHECK (review_month IS NULL OR generated_by IS NOT NULL);

-- TOTAL (no WHERE), so PostgREST's onConflict can infer it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_review_month_writer
  ON conversations (household_id, review_month, generated_by);

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS (5 rows).
-- =============================================================================
--
-- WITH idx AS (
--   SELECT i.indexrelid::regclass::text AS name, i.indisunique AS uniq,
--          pg_get_indexdef(i.indexrelid) AS def, i.indpred IS NULL AS total
--     FROM pg_index i WHERE i.indrelid = 'public.conversations'::regclass
-- ),
-- checks AS (
--   SELECT 'new index: unique, total, on (household_id, review_month, generated_by)' AS check_name,
--          EXISTS (SELECT 1 FROM idx WHERE name = 'idx_conversations_review_month_writer' AND uniq AND total
--                    AND def LIKE '%(household_id, review_month, generated_by)%') AS ok
--   UNION ALL
--   SELECT 'old one-per-month index still present (dropped by part B, after the deploy)',
--          EXISTS (SELECT 1 FROM idx WHERE name = 'idx_conversations_review_month_claim' AND uniq)
--   UNION ALL
--   SELECT 'CHECK: every monthed row names its writer',
--          EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_monthed_has_writer'
--                    AND conrelid = 'public.conversations'::regclass)
--   UNION ALL
--   SELECT 'no monthed row without a writer',
--          NOT EXISTS (SELECT 1 FROM conversations WHERE review_month IS NOT NULL AND generated_by IS NULL)
--   UNION ALL
--   SELECT 'no cron row dated before its own month ended (repair done)',
--          NOT EXISTS (SELECT 1 FROM conversations c JOIN households h ON h.id = c.household_id
--                       WHERE c.review_month IS NOT NULL AND c.generated_by = 'cron'
--                         AND c.created_at < ((to_date(c.review_month || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp
--                                             AT TIME ZONE h.timezone))
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
