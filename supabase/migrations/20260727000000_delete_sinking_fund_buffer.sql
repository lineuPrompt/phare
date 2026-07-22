-- =============================================================================
-- Phare — delete/roll back the sinking-fund buffer, with honest consequences
-- Build 4 Part A (management lifecycle), 2026-07-21.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
--
-- The sinking-fund buffer is a 'savings' account (accounts.is_sinking_fund =
-- true) that, unlike a real goal/debt account, can carry TWO different kinds
-- of real history on it:
--   - type='transfer' rows (chequing→fund contributions) — same shape
--     delete_goal_account already handles: past chequing-side peers get
--     relabeled, never deleted; future pairs are deleted outright.
--   - type='expense' rows (a bill paid straight from the fund, Build 4
--     Part 2) — these have NO chequing-side peer at all; the row itself is
--     the only record. delete_goal_account's blanket "delete every
--     transaction row on this account" would silently erase a real bill
--     payment with no trace — the exact "cash history rewritten" mistake
--     the whole goal-deletion design was built to avoid. This function
--     handles that case by REASSIGNING a past bill-payment row to chequing
--     (the household's one surviving ledger) rather than deleting it: the
--     money really left the household on that real date, the fund just no
--     longer exists to hold the record.
--
-- Money already contributed is NEVER auto-returned to chequing as a new
-- reversing transfer — that would fabricate a withdrawal that never really
-- happened. It stays on record exactly as it happened (relabeled), same
-- principle as delete_goal_account.
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_sinking_fund_buffer(
  p_household_id uuid,
  p_account_id   uuid,
  p_today        date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_chequing_id          uuid;
  v_relabeled_chequing   int;
  v_relabeled_bills      int;
  v_deleted_future_count int;
  v_deleted_past_count   int;
  v_deleted_recurring    boolean := false;
BEGIN
  SELECT id INTO v_chequing_id FROM accounts
   WHERE household_id = p_household_id AND type = 'chequing';

  -- 1. Relabel PAST chequing-side transfer peers — plain record, not deleted.
  UPDATE transactions
     SET description = 'Transfer to deleted sinking fund'
   WHERE household_id = p_household_id
     AND transfer_peer_id IN (
       SELECT id FROM transactions
        WHERE household_id = p_household_id
          AND account_id = p_account_id
          AND type = 'transfer'
          AND date <= p_today
     );
  GET DIAGNOSTICS v_relabeled_chequing = ROW_COUNT;

  -- 2. PAST bill payments (expense rows, no chequing-side peer to relabel):
  -- reassign to chequing and relabel, rather than delete — real spend stays
  -- on the record. Safe for every downstream total: computeMonthTotals
  -- already counts a chequing-account expense row the same way it counts a
  -- sinking-fund one, so this reassignment does not change any historical
  -- month's totals.
  UPDATE transactions
     SET account_id = v_chequing_id,
         description = description || ' (paid from since-deleted sinking fund)'
   WHERE household_id = p_household_id
     AND account_id = p_account_id
     AND type = 'expense'
     AND date <= p_today;
  GET DIAGNOSTICS v_relabeled_bills = ROW_COUNT;

  -- 3. Delete FUTURE transfers entirely, both sides — nothing has actually
  -- happened yet.
  DELETE FROM transactions
   WHERE household_id = p_household_id
     AND (
       (account_id = p_account_id AND type = 'transfer' AND date > p_today)
       OR id IN (
         SELECT transfer_peer_id FROM transactions
          WHERE household_id = p_household_id
            AND account_id = p_account_id
            AND type = 'transfer'
            AND date > p_today
            AND transfer_peer_id IS NOT NULL
       )
     );

  -- 4. Delete FUTURE bill payments too — speculative, never actually paid.
  DELETE FROM transactions
   WHERE household_id = p_household_id
     AND account_id = p_account_id
     AND type = 'expense'
     AND date > p_today;
  GET DIAGNOSTICS v_deleted_future_count = ROW_COUNT;

  -- 5. Delete remaining (past) fund-side transfer rows — the chequing-side
  -- peer (step 1) now carries the history; past bill payments already moved
  -- off this account in step 2, so this only ever touches transfer rows.
  DELETE FROM transactions
   WHERE household_id = p_household_id AND account_id = p_account_id;
  GET DIAGNOSTICS v_deleted_past_count = ROW_COUNT;

  -- 6. Cancel every recurring rule targeting this account — active AND any
  -- historically-superseded row from an earlier contribution-amount edit
  -- (Timeline Part B split model), since both share the same
  -- destination_account_id. Must happen before the account delete below
  -- (destination_account_id is ON DELETE RESTRICT).
  DELETE FROM recurring_items
   WHERE household_id = p_household_id
     AND destination_account_id = p_account_id
     AND type = 'transfer';
  IF FOUND THEN
    v_deleted_recurring := true;
  END IF;

  -- 7. Delete the fund account itself — every sinking_funds row pointing at
  -- it auto-unlinks via linked_account_id's own ON DELETE SET NULL.
  DELETE FROM accounts
   WHERE id = p_account_id AND household_id = p_household_id;

  RETURN jsonb_build_object(
    'relabeledChequingRows', v_relabeled_chequing,
    'relabeledBillPayments', v_relabeled_bills,
    'deletedFutureRows',     v_deleted_future_count,
    'deletedPastFundRows',   v_deleted_past_count,
    'deletedRecurringRule',  v_deleted_recurring
  );
END;
$$;
