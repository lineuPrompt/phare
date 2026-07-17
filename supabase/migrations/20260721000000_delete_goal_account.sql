-- =============================================================================
-- Phare — delete a goal/debt account with honest consequences
-- Applied 2026-07-21.
--
-- A goal account can now be deleted from the UI (previously blocked outright
-- by the generic account-delete guard the moment it had any transactions —
-- every goal has transactions by definition). Deleting one has three parts:
--
--   1. PAST chequing-side rows (date <= p_today) are RELABELED, never
--      deleted — real money really left chequing, the timeline must not
--      rewrite cash history. transfer_peer_id auto-nulls via its own
--      ON DELETE SET NULL once the goal-side row is gone (no manual clear
--      needed).
--   2. FUTURE transfers (date > p_today) are deleted on BOTH sides — nothing
--      has actually happened yet, there is no honest history to preserve,
--      and the goal they were headed to no longer exists.
--   3. The recurring rule targeting this goal (if any) is deleted outright,
--      cancelling all further materialization. This MUST happen before the
--      account delete below — recurring_items.destination_account_id is
--      ON DELETE RESTRICT, so a live rule would block the account delete.
--
-- All goal-side rows (past and future) are deleted — the account itself is
-- going away, and unlike chequing, there is no surviving account for a
-- goal-side row to be "history" on. accounts.id is referenced by
-- transactions.account_id with ON DELETE RESTRICT (not NULL), so every
-- transaction row on this account must be gone before the account itself
-- can be deleted.
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_goal_account(
  p_household_id uuid,
  p_goal_id      uuid,
  p_today        date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_relabeled_count      int;
  v_deleted_future_count int;
  v_deleted_past_count   int;
  v_deleted_recurring    boolean := false;
BEGIN
  -- 1. Relabel PAST chequing-side peers — plain record, not deleted.
  UPDATE transactions
     SET description = 'Transfer to deleted goal'
   WHERE household_id = p_household_id
     AND transfer_peer_id IN (
       SELECT id FROM transactions
        WHERE household_id = p_household_id
          AND account_id = p_goal_id
          AND date <= p_today
     );
  GET DIAGNOSTICS v_relabeled_count = ROW_COUNT;

  -- 2. Delete FUTURE transfers entirely, both sides.
  DELETE FROM transactions
   WHERE household_id = p_household_id
     AND (
       (account_id = p_goal_id AND date > p_today)
       OR id IN (
         SELECT transfer_peer_id FROM transactions
          WHERE household_id = p_household_id
            AND account_id = p_goal_id
            AND date > p_today
            AND transfer_peer_id IS NOT NULL
       )
     );
  GET DIAGNOSTICS v_deleted_future_count = ROW_COUNT;

  -- 3. Delete remaining (past) goal-side rows — the account is going away.
  DELETE FROM transactions
   WHERE household_id = p_household_id AND account_id = p_goal_id;
  GET DIAGNOSTICS v_deleted_past_count = ROW_COUNT;

  -- 4. Cancel the recurring rule targeting this goal, if any — before the
  -- account delete below (destination_account_id is ON DELETE RESTRICT).
  DELETE FROM recurring_items
   WHERE household_id = p_household_id
     AND destination_account_id = p_goal_id
     AND type = 'transfer';
  IF FOUND THEN
    v_deleted_recurring := true;
  END IF;

  -- 5. Delete the goal account itself.
  DELETE FROM accounts
   WHERE id = p_goal_id AND household_id = p_household_id;

  RETURN jsonb_build_object(
    'relabeledChequingRows', v_relabeled_count,
    'deletedFutureRows',     v_deleted_future_count,
    'deletedPastGoalRows',   v_deleted_past_count,
    'deletedRecurringRule',  v_deleted_recurring
  );
END;
$$;
