-- =============================================================================
-- ONE-TIME REPAIR — detached future contributions on ONE goal.
-- Household 2be22642, goal "Ferias e Viagens". Written 2026-08-31.
--
-- Run the three blocks BELOW ONE AT A TIME, in order. Block 2 is wrapped in an
-- explicit transaction with COMMIT on its own line: run everything up to the
-- COMMIT, read the row counts Postgres reports, and only then run the COMMIT.
-- If any count disagrees with the expectation stated above its statement,
-- run ROLLBACK instead.
--
-- WHAT WENT WRONG. The goal card had no way to edit its contribution rule, so
-- the household raised $25/2wk to $125/2wk by editing each upcoming
-- materialized row by hand. Every edit ran detach-on-edit (PATCH
-- /api/transfers/[id]): a tombstone on the row's date, and recurring_item_id
-- nulled on BOTH sides of the transfer pair. The rows say $125, the rule still
-- says $25, and no foreign key survives to connect them.
--
-- WHY THE REPAIR IS NEEDED BEFORE RULE EDITING HELPS. splitRule deletes the old
-- rule's rows from the effective boundary forward BY recurring_item_id. Against
-- 24 detached rows that DELETE matches nothing, and the carried tombstones then
-- stop the new rule re-materializing those dates. Editing the rule would be a
-- no-op. Re-attaching first is what makes the normal path work.
--
-- WHAT THIS DOES — and does not do.
--   * re-attaches 24 detached goal-side rows + their 24 chequing-side peers
--   * deletes the 24 tombstones on that rule dated after the cutoff
--   * changes NO amounts, creates NO rows, deletes NO rows other than those
--     tombstones, and touches NOTHING dated on or before the cutoff
-- The actual $25 -> $125 change is made afterwards through the contribution
-- editor, which takes the normal split path (effective from the 1st of next
-- month) and leaves Aug 12 / Aug 26 exactly as they are.
--
-- THE CUTOFF IS A LITERAL, DELIBERATELY. '2026-08-31' was the household's
-- business day when this was written. now()/CURRENT_DATE would silently select
-- a different row set on a later day. Block 1 prints CURRENT_DATE next to the
-- literal: if they differ, STOP — rows that were future are now history, and
-- re-attaching them would no longer be the same operation.
--
-- Every statement is scoped by household_id AND by the specific rule or
-- account. No statement can reach another household.
-- =============================================================================


-- =============================================================================
-- BLOCK 1 — BEFORE. Read-only. Confirm every number matches before writing.
--
-- Expected, matching the dry run of 2026-08-31:
--   1a  cutoff_is_still_today .............. true
--   1b  past rows ........................... 2   (Aug 12 $25, Aug 26 $25, rule fb0157da)
--   1c  future detached goal rows ........... 24  (all $125, all recurring_item_id NULL)
--   1d  future detached peer rows ........... 24
--   1e  tombstones after cutoff ............. 24
--   1f  household transaction total ......... note this number for BLOCK 3
-- =============================================================================

-- 1a. Is the cutoff still the household's today? If false, STOP.
SELECT
  DATE '2026-08-31'                        AS cutoff,
  CURRENT_DATE                             AS today_utc,
  (CURRENT_DATE = DATE '2026-08-31')       AS cutoff_is_still_today;

-- 1b. Past rows on the goal — must be left completely untouched.
SELECT t.date, t.amount, t.recurring_item_id, t.description
  FROM transactions t
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type              = 'transfer'
   AND t.date             <= DATE '2026-08-31'
 ORDER BY t.date;

-- 1c. Future detached goal-side rows — the 24 to re-attach.
SELECT t.date, t.amount, t.recurring_item_id, t.transfer_peer_id
  FROM transactions t
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type              = 'transfer'
   AND t.date              > DATE '2026-08-31'
   AND t.recurring_item_id IS NULL
 ORDER BY t.date;

-- 1d. Their chequing-side peers. Found through the pair link in BOTH
-- directions — either side may carry transfer_peer_id — never by hardcoding a
-- chequing account id.
SELECT t.date, t.amount, t.account_id, t.recurring_item_id
  FROM transactions t
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.type              = 'transfer'
   AND t.date              > DATE '2026-08-31'
   AND t.recurring_item_id IS NULL
   AND t.account_id       <> '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND (
         t.id IN (
           SELECT g.transfer_peer_id FROM transactions g
            WHERE g.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
              AND g.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
              AND g.type              = 'transfer'
              AND g.date              > DATE '2026-08-31'
              AND g.recurring_item_id IS NULL
              AND g.transfer_peer_id IS NOT NULL
         )
      OR t.transfer_peer_id IN (
           SELECT g.id FROM transactions g
            WHERE g.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
              AND g.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
              AND g.type              = 'transfer'
              AND g.date              > DATE '2026-08-31'
              AND g.recurring_item_id IS NULL
         )
       )
 ORDER BY t.date;

-- 1e. Tombstones on the rule after the cutoff — the 24 to delete.
SELECT s.date
  FROM recurring_skipped_dates s
 WHERE s.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND s.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
   AND s.date              > DATE '2026-08-31'
 ORDER BY s.date;

-- 1f. Total transactions for this household. BLOCK 3 must report the same
-- number — this repair creates and deletes no transaction rows.
SELECT count(*) AS household_transaction_total
  FROM transactions
 WHERE household_id = '2be22642-53c5-4599-ad3b-42a076e10484';


-- =============================================================================
-- BLOCK 2 — THE MUTATION. Run down to (but not including) COMMIT, check the
-- two row counts, then run COMMIT on its own. ROLLBACK if either disagrees.
-- =============================================================================

BEGIN;

-- 2a. Re-attach both sides in ONE statement.
--
-- A single UPDATE evaluates its WHERE against the pre-update snapshot, so the
-- peer subqueries still see the goal rows as detached while the same statement
-- is attaching them. Splitting this into two statements would not: the second
-- would find nothing.
--
-- EXPECT EXACTLY 48 ROWS (24 goal-side + 24 chequing-side peers).
-- Any other number: ROLLBACK.
UPDATE transactions t
   SET recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.type              = 'transfer'
   AND t.date              > DATE '2026-08-31'
   AND t.recurring_item_id IS NULL
   AND (
         t.account_id = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
      OR t.id IN (
           SELECT g.transfer_peer_id FROM transactions g
            WHERE g.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
              AND g.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
              AND g.type              = 'transfer'
              AND g.date              > DATE '2026-08-31'
              AND g.recurring_item_id IS NULL
              AND g.transfer_peer_id IS NOT NULL
         )
      OR t.transfer_peer_id IN (
           SELECT g.id FROM transactions g
            WHERE g.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
              AND g.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
              AND g.type              = 'transfer'
              AND g.date              > DATE '2026-08-31'
              AND g.recurring_item_id IS NULL
         )
       );

-- 2b. Remove the tombstones that would otherwise stop the new rule
-- re-materializing these dates.
--
-- EXPECT EXACTLY 24 ROWS. Any other number: ROLLBACK.
DELETE FROM recurring_skipped_dates s
 WHERE s.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND s.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
   AND s.date              > DATE '2026-08-31';

COMMIT;


-- =============================================================================
-- BLOCK 3 — VERIFY. Read-only. Run after COMMIT.
--
-- Expected:
--   3a  goal rows carrying the rule after cutoff ....... 24
--       peer rows carrying the rule after cutoff ....... 24
--       still-detached rows after cutoff ............... 0
--   3b  tombstones after cutoff ........................ 0
--   3c  the two August rows still $25.00 on rule fb0157da, dates unchanged
--   3d  household transaction total .................... same as 1f
--   3e  amounts after cutoff ........................... all still 125.00
-- =============================================================================

-- 3a. Both sides attached, nothing left detached.
SELECT
  count(*) FILTER (
    WHERE t.account_id = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
      AND t.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
  ) AS goal_rows_attached,
  count(*) FILTER (
    WHERE t.account_id <> '310af3be-2d46-45ee-baf8-9ee7ce92657b'
      AND t.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
  ) AS peer_rows_attached,
  count(*) FILTER (
    WHERE t.recurring_item_id IS NULL
      AND ( t.account_id = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
         OR t.transfer_peer_id IN (
              SELECT g.id FROM transactions g
               WHERE g.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
                 AND g.account_id   = '310af3be-2d46-45ee-baf8-9ee7ce92657b' ) )
  ) AS still_detached
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.type         = 'transfer'
   AND t.date         > DATE '2026-08-31';

-- 3b. No tombstones left after the cutoff. Expect 0.
SELECT count(*) AS tombstones_after_cutoff
  FROM recurring_skipped_dates s
 WHERE s.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND s.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
   AND s.date              > DATE '2026-08-31';

-- 3c. History untouched: Aug 12 and Aug 26, still $25.00, still on fb0157da.
SELECT t.date, t.amount, t.recurring_item_id
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id   = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type         = 'transfer'
   AND t.date        <= DATE '2026-08-31'
 ORDER BY t.date;

-- 3d. Row count unchanged — must equal 1f.
SELECT count(*) AS household_transaction_total
  FROM transactions
 WHERE household_id = '2be22642-53c5-4599-ad3b-42a076e10484';

-- 3e. No amount was rewritten: every future goal row is still 125.00.
SELECT DISTINCT t.amount AS distinct_future_goal_amounts
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id   = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type         = 'transfer'
   AND t.date         > DATE '2026-08-31';
