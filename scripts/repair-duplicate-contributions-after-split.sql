-- =============================================================================
-- CORRECTIVE REPAIR — duplicate future contributions on ONE goal.
-- Household 2be22642, goal "Ferias e Viagens". 2026-09-01.
--
-- READ THIS FIRST. This cleans up damage caused by the PREVIOUS repair
-- (scripts/repair-detached-goal-contributions.sql) being run AFTER the
-- contribution editor rather than before it. That file assumed an ordering it
-- did not verify. See "WHY THIS HAPPENED" below — the flaw is mine, and the
-- BEFORE block here checks the thing the last one failed to.
--
-- CURRENT STATE, read from production 2026-09-01:
--   Two transfer rules point at the goal:
--     fb0157da  $25  biweekly  active=false                    (frozen)
--     97a41c9b  $125 biweekly  active=true   effective_from=2026-10-01
--                                            predecessor_id=fb0157da
--   The goal carries 53 transfer rows. From 2026-10-07 to 2027-07-28, 22
--   dates each hold TWO complete pairs — one under each rule, both $125.
--   The household is therefore scheduled to contribute $250 per fortnight
--   instead of $125, for ten months.
--
-- WHY THIS HAPPENED. splitRule freezes the old rule and deletes ITS rows from
-- the effective boundary forward, keyed on recurring_item_id. When the editor
-- ran, those rows were still DETACHED (recurring_item_id NULL, from the
-- original hand-editing), so that DELETE matched nothing — exactly the no-op
-- the whole re-attach repair existed to prevent. The new rule then
-- materialized a full set from 2026-10-01. Running the re-attach afterwards
-- pointed the old, superseded rows back at fb0157da, resurrecting them
-- alongside the new ones.
--
-- The previous file's BLOCK 1 could not catch this: whether the editor had
-- already run or not, it saw the same 24 detached rows, because the split's
-- DELETE had matched none of them. A guard that cannot distinguish the safe
-- ordering from the unsafe one is not a guard. Hence 1a below, which checks
-- the RULES, not just the rows.
--
-- WHAT THIS DOES.
--   Deletes the 44 superseded rows (22 goal-side + 22 chequing peers) that
--   splitRule would have deleted had it been able to see them: precisely
--   recurring_item_id = fb0157da AND date >= 2026-10-01.
--
-- WHAT IT LEAVES ALONE — everything else, specifically:
--   * 2026-08-12 $25 and 2026-08-26 $25 on fb0157da — real history
--   * 2026-09-09 $125 and 2026-09-23 $125 on fb0157da — future, but BEFORE
--     the successor's effective_from. Rows under a frozen predecessor ahead
--     of the boundary are the forward-apply guarantee working, not drift.
--   * all 26 rows on 97a41c9b from 2026-10-07 — the live rule's own set
--   * the 2026-09-01 $110 opening balance (is_opening_balance = true,
--     one-sided, no peer) — unrelated, and correct
--
-- NO CLOCK DEPENDENCY, DELIBERATELY. The predicate is a rule id and the
-- successor's own effective_from, both fixed. There is nothing to re-pin and
-- no date guard to go stale: running this tomorrow selects the same 44 rows.
-- (Where a one-off DOES need "today", compare against the household's
-- timezone — (now() AT TIME ZONE households.timezone)::date — never
-- CURRENT_DATE, which is UTC. See the standing-rule note in the previous
-- repair file.)
--
-- Every statement is scoped by household_id AND the specific rule. No
-- statement can reach another household.
-- =============================================================================


-- =============================================================================
-- BLOCK 1 — BEFORE. Read-only. ALL FIVE must match before running BLOCK 2.
--
--   1a  two rules, fb0157da inactive + 97a41c9b active eff 2026-10-01
--   1b  rows to delete ............................ 44  (22 goal + 22 peer)
--   1c  rows kept on fb0157da (goal side) ......... 4   (Aug 12/26 $25, Sep 9/23 $125)
--   1d  goal dates holding two rows ............... 22  (2026-10-07 .. 2027-07-28)
--   1e  household transaction total ............... note it for BLOCK 3
--
-- If 1a shows only ONE rule, STOP — the editor has not run and this file does
-- not apply. If 1d shows 0, STOP — there is nothing to clean up.
-- =============================================================================

-- 1a. THE CHECK THE LAST FILE WAS MISSING: what rules exist for this goal?
SELECT r.id, r.amount, r.cadence, r.active, r.effective_from, r.predecessor_id
  FROM recurring_items r
 WHERE r.household_id           = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND r.type                   = 'transfer'
   AND r.destination_account_id = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
 ORDER BY r.active, r.effective_from NULLS FIRST;

-- 1b. The 44 superseded rows this will delete. Expect 22 goal + 22 peer,
-- 2026-10-07 .. 2027-07-28, every amount 125.00.
SELECT t.date, t.amount, t.account_id,
       (t.account_id = '310af3be-2d46-45ee-baf8-9ee7ce92657b') AS is_goal_side
  FROM transactions t
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
   AND t.date             >= DATE '2026-10-01'
 ORDER BY t.date, is_goal_side DESC;

-- 1c. Rows on the frozen rule that must SURVIVE — everything before the
-- successor's effective_from. Expect 4 goal-side rows.
SELECT t.date, t.amount
  FROM transactions t
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id        = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
   AND t.date              < DATE '2026-10-01'
 ORDER BY t.date;

-- 1d. The duplication itself: goal dates carrying more than one row.
-- Expect 22 rows, each with count 2.
SELECT t.date, count(*) AS rows_on_this_date
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id   = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type         = 'transfer'
 GROUP BY t.date
HAVING count(*) > 1
 ORDER BY t.date;

-- 1e. Household transaction total. BLOCK 3 must equal this MINUS 44.
SELECT count(*) AS household_transaction_total
  FROM transactions
 WHERE household_id = '2be22642-53c5-4599-ad3b-42a076e10484';


-- =============================================================================
-- BLOCK 2 — THE MUTATION. Run down to (but not including) COMMIT, check the
-- row count, then run COMMIT on its own. ROLLBACK if it disagrees.
-- =============================================================================

BEGIN;

-- 2a. Delete exactly what splitRule would have deleted. Both sides of every
-- pair carry recurring_item_id, so this single statement removes the goal row
-- and its chequing peer together — no peer-chasing subquery needed.
--
-- EXPECT EXACTLY 44 ROWS (22 goal-side + 22 chequing peers).
-- Any other number: ROLLBACK.
DELETE FROM transactions t
 WHERE t.household_id      = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.recurring_item_id = 'fb0157da-cdb9-42b1-b090-6a85eb65442a'
   AND t.date             >= DATE '2026-10-01';

COMMIT;


-- =============================================================================
-- BLOCK 3 — VERIFY. Read-only. Run after COMMIT.
--
--   3a  goal dates holding two rows ............... 0
--   3b  fb0157da rows remaining ................... 8   (4 goal + 4 peer, all < 2026-10-01)
--   3c  97a41c9b rows ............................. 52  (26 goal + 26 peer)
--   3d  history intact: Aug 12 $25, Aug 26 $25, Sep 9 $125, Sep 23 $125
--   3e  household transaction total ............... 1e minus 44
--   3f  the $110 opening balance still present
-- =============================================================================

-- 3a. No date carries two contributions any more. Expect 0 rows.
SELECT t.date, count(*) AS rows_on_this_date
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id   = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type         = 'transfer'
 GROUP BY t.date
HAVING count(*) > 1
 ORDER BY t.date;

-- 3b/3c. What each rule now owns. Expect fb0157da 8 (max date 2026-09-23),
-- 97a41c9b 52 (min date 2026-10-07).
SELECT t.recurring_item_id,
       count(*)      AS rows_total,
       min(t.date)   AS first_date,
       max(t.date)   AS last_date
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.recurring_item_id IN (
         'fb0157da-cdb9-42b1-b090-6a85eb65442a',
         '97a41c9b-9e9c-4b96-a2e6-538539d00e47'
       )
 GROUP BY t.recurring_item_id;

-- 3d. The goal's own ledger, start to finish. Aug 12/26 still $25; Sep 9/23
-- still $125; then $125 fortnightly from 2026-10-07 with NO repeats.
SELECT t.date, t.amount, t.recurring_item_id, t.is_opening_balance
  FROM transactions t
 WHERE t.household_id = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id   = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.type         = 'transfer'
 ORDER BY t.date;

-- 3e. Row count: must equal 1e minus 44.
SELECT count(*) AS household_transaction_total
  FROM transactions
 WHERE household_id = '2be22642-53c5-4599-ad3b-42a076e10484';

-- 3f. The opening balance is untouched by all of this. Expect 1 row, $110.
SELECT t.date, t.amount, t.is_opening_balance
  FROM transactions t
 WHERE t.household_id       = '2be22642-53c5-4599-ad3b-42a076e10484'
   AND t.account_id         = '310af3be-2d46-45ee-baf8-9ee7ce92657b'
   AND t.is_opening_balance = true;
