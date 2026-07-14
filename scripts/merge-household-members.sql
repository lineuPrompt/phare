-- =============================================================================
-- Phare — household member merge script
-- FOUNDER/DEV TOOL. Not exposed anywhere in the UI. Run manually in the
-- Supabase SQL Editor. Heals the exact class of bug the invite endpoint's
-- match-before-create fix now prevents going forward: a name-only member
-- created during onboarding discovery (e.g. "Julia", user_id null) that
-- later got a SECOND, separate row when invited by full name (e.g. "Julia
-- Alff", with a real login) instead of being matched and attached.
-- =============================================================================
--
-- PURPOSE
--   Merge two household_members rows into one: re-point every foreign key
--   that references the REMOVE row onto the KEEP row, carry over the
--   REMOVE row's login (user_id) onto KEEP if KEEP doesn't already have
--   one, then delete the REMOVE row. All existing attribution — recurring
--   items, transactions, budgets, budget alerts — survives on the KEEP
--   row's id, which never changes.
--
-- WHICH ROW TO KEEP
--   Usually the OLDER row (the one with real transaction/recurring-item
--   history — created during onboarding discovery), not the newer one
--   (created moments ago by the buggy invite, likely with zero real
--   attribution yet). If the REMOVE row is the one with the real login
--   (user_id set) and KEEP doesn't have one, this script copies user_id —
--   and the fuller of the two names — onto KEEP automatically, so the
--   surviving row ends up with BOTH the history AND the login. Find both
--   ids with:
--     SELECT id, name, user_id, created_at FROM household_members
--     WHERE household_id = 'YOUR-HOUSEHOLD-ID' ORDER BY created_at;
--
-- EVERY TABLE TOUCHED (every FK to household_members(id) in the schema —
-- confirmed by grep across supabase/migrations/, four tables, no others)
--   recurring_items.member_id  — re-pointed (nullable, ON DELETE SET NULL,
--                                 but merge re-points explicitly rather
--                                 than letting a delete null it out)
--   transactions.member_id     — re-pointed (nullable, but the FK has no
--                                 ON DELETE action — MUST be re-pointed
--                                 before the delete or it fails outright)
--   budgets.member_id          — re-pointed, EXCEPT where the target member
--                                 already has a budget row for the same
--                                 (household_id, category_id, month) — that
--                                 UNIQUE constraint means blindly re-pointing
--                                 could collide. Colliding rows fall back to
--                                 member_id = NULL (household-level) rather
--                                 than silently dropping one of two
--                                 conflicting amounts or guessing which is
--                                 correct.
--   budget_alerts.member_id    — re-pointed (nullable, ON DELETE SET NULL)
--   household_members itself   — REMOVE row's user_id/name merge onto KEEP,
--                                 then REMOVE row deleted.
--
-- SAFETY CONTRACT
--   • Scoped to two specific member ids you paste below — every UPDATE and
--     the final DELETE are filtered by them, nothing else in the household
--     is touched.
--   • Guard checks abort (RAISE EXCEPTION → automatic ROLLBACK) before any
--     write if either id doesn't exist, if they don't belong to the SAME
--     household, or if they're the same id.
--   • Runs inside a single transaction (BEGIN...COMMIT).
--   • Ends with verification SELECTs — the REMOVE row must be gone, the KEEP
--     row must show a nonzero total across the four tables above (unless
--     the duplicate genuinely had no attribution yet, in which case 0 is
--     also correct — read the counts, don't just check for zero errors).
--
-- HOW TO RUN
--   1. Open Supabase → SQL Editor.
--   2. Run the query in "WHICH ROW TO KEEP" above to find both ids.
--   3. Paste keep_id and remove_id into the INSERT below.
--   4. Read the script once more end-to-end.
--   5. Run the whole script. Check the verification result sets.
-- =============================================================================

DROP TABLE IF EXISTS _merge_target;
CREATE TEMP TABLE _merge_target (keep_id uuid, remove_id uuid);

-- <<< REPLACE both UUIDs below, then run the whole script. >>>
INSERT INTO _merge_target (keep_id, remove_id) VALUES (
  'PASTE-MEMBER-ID-TO-KEEP-HERE'::uuid,
  'PASTE-MEMBER-ID-TO-REMOVE-HERE'::uuid
);

BEGIN;

DO $$
DECLARE
  kid uuid := (SELECT keep_id FROM _merge_target);
  rid uuid := (SELECT remove_id FROM _merge_target);
  keep_household   uuid;
  remove_household uuid;
BEGIN
  IF kid = rid THEN
    RAISE EXCEPTION 'keep_id and remove_id are the same (%) — nothing to merge.', kid;
  END IF;

  SELECT household_id INTO keep_household FROM household_members WHERE id = kid;
  SELECT household_id INTO remove_household FROM household_members WHERE id = rid;

  IF keep_household IS NULL THEN
    RAISE EXCEPTION 'No household_members row found for keep_id % — aborting, nothing was changed.', kid;
  END IF;
  IF remove_household IS NULL THEN
    RAISE EXCEPTION 'No household_members row found for remove_id % — aborting, nothing was changed.', rid;
  END IF;
  IF keep_household != remove_household THEN
    RAISE EXCEPTION 'keep_id (household %) and remove_id (household %) belong to DIFFERENT households — refusing to merge across households.', keep_household, remove_household;
  END IF;
END $$;

-- STEP 1 — recurring_items: re-point every row off the REMOVE member.
UPDATE recurring_items
SET member_id = (SELECT keep_id FROM _merge_target)
WHERE member_id = (SELECT remove_id FROM _merge_target);

-- STEP 2 — transactions: re-point every row off the REMOVE member. Must
-- happen before the delete below — this FK has no ON DELETE action, so a
-- transaction still pointing at the REMOVE row would block the delete.
UPDATE transactions
SET member_id = (SELECT keep_id FROM _merge_target)
WHERE member_id = (SELECT remove_id FROM _merge_target);

-- STEP 3a — budgets: re-point rows that DON'T collide with an existing
-- budget already on the KEEP member for the same (household_id,
-- category_id, month) — the UNIQUE(household_id, category_id, member_id,
-- month) constraint would reject a blind re-point of a colliding row.
UPDATE budgets b
SET member_id = (SELECT keep_id FROM _merge_target)
WHERE b.member_id = (SELECT remove_id FROM _merge_target)
  AND NOT EXISTS (
    SELECT 1 FROM budgets b2
    WHERE b2.household_id = b.household_id
      AND b2.category_id  = b.category_id
      AND b2.month        = b.month
      AND b2.member_id    = (SELECT keep_id FROM _merge_target)
  );

-- STEP 3b — any REMOVE-owned budget rows that DID collide (both members had
-- a budget for the same category/month): fall back to household-level
-- (NULL) rather than silently dropping one of two conflicting amounts, or
-- guessing which is correct. Whoever owns the household can re-split them
-- manually afterward with real information this script doesn't have.
UPDATE budgets
SET member_id = NULL
WHERE member_id = (SELECT remove_id FROM _merge_target);

-- STEP 4 — budget_alerts: re-point every row off the REMOVE member.
UPDATE budget_alerts
SET member_id = (SELECT keep_id FROM _merge_target)
WHERE member_id = (SELECT remove_id FROM _merge_target);

-- STEP 5 — carry the REMOVE row's login onto KEEP if KEEP doesn't have one
-- yet, and keep whichever name is fuller (longer) — the same rule the
-- invite endpoint's automatic attach now applies going forward.
UPDATE household_members k
SET
  user_id = COALESCE(k.user_id, r.user_id),
  name    = CASE WHEN length(r.name) > length(k.name) THEN r.name ELSE k.name END
FROM household_members r
WHERE k.id = (SELECT keep_id FROM _merge_target)
  AND r.id = (SELECT remove_id FROM _merge_target);

-- STEP 6 — delete the now-empty REMOVE row. Every FK that pointed at it has
-- already been re-pointed above, so this is a clean delete, not an orphan.
DELETE FROM household_members
WHERE id = (SELECT remove_id FROM _merge_target);

COMMIT;

-- =============================================================================
-- VERIFICATION 1 — the REMOVE row must be gone.
-- =============================================================================
SELECT count(*) AS remove_row_still_exists_must_be_0
FROM household_members WHERE id = (SELECT remove_id FROM _merge_target);

-- =============================================================================
-- VERIFICATION 2 — the KEEP row, with its merged identity and attribution.
-- =============================================================================
SELECT id, name, user_id FROM household_members WHERE id = (SELECT keep_id FROM _merge_target);

SELECT 'recurring_items' AS table_name, count(*) AS rows_on_keep FROM recurring_items WHERE member_id = (SELECT keep_id FROM _merge_target)
UNION ALL SELECT 'transactions',   count(*) FROM transactions   WHERE member_id = (SELECT keep_id FROM _merge_target)
UNION ALL SELECT 'budgets',        count(*) FROM budgets        WHERE member_id = (SELECT keep_id FROM _merge_target)
UNION ALL SELECT 'budget_alerts',  count(*) FROM budget_alerts  WHERE member_id = (SELECT keep_id FROM _merge_target);

DROP TABLE _merge_target;
