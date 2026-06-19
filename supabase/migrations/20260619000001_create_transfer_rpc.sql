-- =============================================================================
-- Phare — create_transfer RPC
-- Applied 2026-06-19.
-- Atomic chequing→goal transfer: both rows + both peer links in one transaction.
-- Any failure rolls back completely — no partial pairs can persist.
--
-- SECURITY INVOKER: runs as the calling user so RLS applies normally.
-- The transactions_all policy (FOR ALL USING household_id = auth_household_id())
-- permits inserts when the authenticated user's household matches p_household_id.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_transfer(
  p_household_id  uuid,
  p_member_id     uuid,
  p_chequing_id   uuid,
  p_goal_id       uuid,
  p_amount        numeric,
  p_date          date,
  p_description   text
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
    type,           source
  ) VALUES (
    p_household_id, p_member_id,  p_goal_id,
    p_amount,       p_description, p_date,
    'transfer',     'manual'
  )
  RETURNING id INTO v_goal_id;

  -- 2. Insert chequing-side row, already linking to the goal row
  INSERT INTO transactions (
    household_id,   member_id,    account_id,
    amount,         description,  date,
    type,           source,       transfer_peer_id
  ) VALUES (
    p_household_id, p_member_id,  p_chequing_id,
    p_amount,       p_description, p_date,
    'transfer',     'manual',     v_goal_id
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
