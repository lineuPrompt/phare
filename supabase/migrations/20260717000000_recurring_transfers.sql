-- =============================================================================
-- Phare — recurring transfers to goal accounts (Build 4 Phase 2)
-- Applied 2026-07-17.
--
-- A recurring item can now be type='transfer': a chequing→goal transfer that
-- materializes on a schedule (same cadences as income/expense: monthly,
-- biweekly, semimonthly, weekly). account_id continues to mean "chequing/
-- source side" for every type — destination_account_id is the new goal
-- target, used only when type='transfer'.
--
-- Materialized occurrences are created through the SAME create_transfer RPC
-- one-off transfers already use (atomic pair-insert), never a raw
-- transactions insert — extended here with an optional recurring_item_id so
-- both sides of a materialized pair carry it, and a single
-- DELETE ... WHERE recurring_item_id = $1 removes both sides atomically
-- when a recurring rule is edited or deleted.
-- =============================================================================

ALTER TABLE recurring_items DROP CONSTRAINT IF EXISTS recurring_items_type_check;
ALTER TABLE recurring_items ADD CONSTRAINT recurring_items_type_check
  CHECK (type IN ('income', 'expense', 'transfer'));

ALTER TABLE recurring_items ADD COLUMN IF NOT EXISTS destination_account_id uuid
  REFERENCES accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_recurring_destination_account
  ON recurring_items (destination_account_id);

-- Extend create_transfer with an optional p_recurring_item_id (default NULL
-- — existing one-off transfer callers are unaffected). Tags BOTH inserted
-- rows so they can later be found and removed together by recurring_item_id.
CREATE OR REPLACE FUNCTION create_transfer(
  p_household_id      uuid,
  p_member_id         uuid,
  p_chequing_id       uuid,
  p_goal_id           uuid,
  p_amount            numeric,
  p_date              date,
  p_description       text,
  p_recurring_item_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_goal_id uuid;
  v_chq_id  uuid;
BEGIN
  -- 1. Insert goal-side row (transfer_peer_id left null until we have the chequing id)
  INSERT INTO transactions (
    household_id,   member_id,    account_id,
    amount,         description,  date,
    type,           source,       recurring_item_id
  ) VALUES (
    p_household_id, p_member_id,  p_goal_id,
    p_amount,       p_description, p_date,
    'transfer',     'manual',     p_recurring_item_id
  )
  RETURNING id INTO v_goal_id;

  -- 2. Insert chequing-side row, already linking to the goal row
  INSERT INTO transactions (
    household_id,   member_id,    account_id,
    amount,         description,  date,
    type,           source,       transfer_peer_id, recurring_item_id
  ) VALUES (
    p_household_id, p_member_id,  p_chequing_id,
    p_amount,       p_description, p_date,
    'transfer',     'manual',     v_goal_id,        p_recurring_item_id
  )
  RETURNING id INTO v_chq_id;

  -- 3. Close the link: goal row points back to chequing row
  UPDATE transactions
     SET transfer_peer_id = v_chq_id
   WHERE id = v_goal_id;

  RETURN jsonb_build_object(
    'chequing_row_id', v_chq_id,
    'goal_row_id',     v_goal_id
  );
END;
$$;
