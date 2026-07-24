-- =============================================================================
-- Phare — create_transfer: p_kind ('contribution' | 'draw')
-- Applied 2026-08-01.
--
-- PROBLEM: a credit-line draw (borrowing cash INTO chequing FROM a debt
-- account) had no representation in the ledger at all. create_transfer was
-- strictly one-directional — chequing always the debit side, a goal/debt
-- account always the credit side — so a household recording a draw had to
-- type two disconnected rows by hand: a plain type='income' row on chequing
-- (inflating surplus, indistinguishable from earned income) and an orphan
-- type='transfer' row on the debt account with no transfer_peer_id. Nothing
-- enforced they agreed, and nothing marked the cash as borrowed.
--
-- FIX: one transfer path, not a sibling RPC — p_kind selects direction.
--   'contribution' (default, unchanged behaviour): chequing → goal, amount
--     stored positive on both sides, exactly as before.
--   'draw' (new, debt only): the mirror of a payment. Both paired rows store
--     the NEGATIVE of p_amount instead of the positive value. This is not an
--     arbitrary sign choice — it reuses two conventions this codebase
--     already relies on elsewhere rather than inventing a new "kind" column:
--       * computeGoalBalance (dashboardHelpers.ts) already sums a goal's
--         'transfer' rows by literal signed amount with no special-casing —
--         the debt opening-balance seed (POST /api/accounts) already stores
--         a literal negative amount for exactly this reason. A negative
--         debt-side draw row therefore makes the balance MORE negative (owe
--         more) for free, no computeGoalBalance change needed.
--       * timelineHelpers.ts's signAmount() computes a chequing 'transfer'
--         row's effect on the running balance as `-tx.amount`. A negative
--         stored amount on the chequing-side draw row flips that to a
--         genuine positive balance increase — again for free, no signAmount
--         change needed. (See the TRANSFER DIRECTION NOTE in that file,
--         which anticipated this exact feature.)
--   Draws are restricted to a 'debt' destination — RAISE EXCEPTION otherwise.
--   p_amount stays a required positive MAGNITUDE for both kinds; only the
--   stored row amount's sign differs.
--
-- Signature adds one new trailing parameter with a default, which changes
-- the function's argument-type signature — CREATE OR REPLACE alone would
-- create a second overload alongside the 8-arg version (exactly the bug
-- 20260719000000_fix_create_transfer_overload.sql fixed once already), so
-- the old signature is dropped explicitly first.
-- =============================================================================

DROP FUNCTION IF EXISTS create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid);

CREATE OR REPLACE FUNCTION create_transfer(
  p_household_id      uuid,
  p_member_id         uuid,
  p_chequing_id       uuid,
  p_goal_id           uuid,
  p_amount            numeric,
  p_date              date,
  p_description       text,
  p_recurring_item_id uuid DEFAULT NULL,
  p_kind              text DEFAULT 'contribution'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_goal_id       uuid;
  v_chq_id        uuid;
  v_chequing_type text;
  v_goal_type     text;
  v_signed_amount numeric;
BEGIN
  -- ── Required-field checks ──────────────────────────────────────────────
  IF p_household_id IS NULL THEN
    RAISE EXCEPTION 'create_transfer: p_household_id is required';
  END IF;
  IF p_member_id IS NULL THEN
    RAISE EXCEPTION 'create_transfer: p_member_id is required';
  END IF;
  IF p_chequing_id IS NULL OR p_goal_id IS NULL THEN
    RAISE EXCEPTION 'create_transfer: p_chequing_id and p_goal_id are required';
  END IF;
  IF p_chequing_id = p_goal_id THEN
    RAISE EXCEPTION 'create_transfer: p_chequing_id and p_goal_id must differ';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'create_transfer: p_amount must be positive';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'create_transfer: p_date is required';
  END IF;
  IF p_kind NOT IN ('contribution', 'draw') THEN
    RAISE EXCEPTION 'create_transfer: p_kind must be contribution or draw (got %)', p_kind;
  END IF;

  -- ── Tenant checks ───────────────────────────────────────────────────────
  -- Member must belong to the household making the transfer.
  IF NOT EXISTS (
    SELECT 1 FROM household_members
     WHERE id = p_member_id AND household_id = p_household_id
  ) THEN
    RAISE EXCEPTION 'create_transfer: member % does not belong to household %', p_member_id, p_household_id;
  END IF;

  -- Source account must belong to the household and be chequing.
  SELECT type INTO v_chequing_type
    FROM accounts WHERE id = p_chequing_id AND household_id = p_household_id;
  IF v_chequing_type IS NULL THEN
    RAISE EXCEPTION 'create_transfer: chequing account % does not belong to household %', p_chequing_id, p_household_id;
  END IF;
  IF v_chequing_type <> 'chequing' THEN
    RAISE EXCEPTION 'create_transfer: account % is not a chequing account (type=%)', p_chequing_id, v_chequing_type;
  END IF;

  -- Destination account must belong to the household and be a goal type.
  SELECT type INTO v_goal_type
    FROM accounts WHERE id = p_goal_id AND household_id = p_household_id;
  IF v_goal_type IS NULL THEN
    RAISE EXCEPTION 'create_transfer: goal account % does not belong to household %', p_goal_id, p_household_id;
  END IF;
  IF v_goal_type NOT IN ('savings', 'tfsa', 'rrsp', 'debt') THEN
    RAISE EXCEPTION 'create_transfer: account % is not a goal account (type=%)', p_goal_id, v_goal_type;
  END IF;

  -- A draw is only meaningful against a debt: it represents borrowing
  -- against a credit line/loan, not withdrawing from a savings-style goal
  -- (that's a different, unbuilt feature with different implications).
  IF p_kind = 'draw' AND v_goal_type <> 'debt' THEN
    RAISE EXCEPTION 'create_transfer: draws are only valid against a debt account (account % is type=%)', p_goal_id, v_goal_type;
  END IF;

  v_signed_amount := CASE WHEN p_kind = 'draw' THEN -p_amount ELSE p_amount END;

  -- ── Insert the atomic pair ─────────────────────────────────────────────

  -- 1. Insert goal-side row (transfer_peer_id left null until we have the chequing id)
  INSERT INTO transactions (
    household_id,   member_id,    account_id,
    amount,          description,  date,
    type,           source,       recurring_item_id
  ) VALUES (
    p_household_id, p_member_id,  p_goal_id,
    v_signed_amount, p_description, p_date,
    'transfer',     'manual',     p_recurring_item_id
  )
  RETURNING id INTO v_goal_id;

  -- 2. Insert chequing-side row, already linking to the goal row
  INSERT INTO transactions (
    household_id,   member_id,    account_id,
    amount,          description,  date,
    type,           source,       transfer_peer_id, recurring_item_id
  ) VALUES (
    p_household_id, p_member_id,  p_chequing_id,
    v_signed_amount, p_description, p_date,
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

-- ── EXECUTE privilege ─────────────────────────────────────────────────────
-- Same rationale as 20260722000000_harden_create_transfer_tenant_checks.sql:
-- the only intended gateway is the server-side API routes running as the
-- authenticated Supabase client. Re-applied here because DROP FUNCTION above
-- removed the previous grant state along with the old signature.
REVOKE EXECUTE ON FUNCTION create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid, text) FROM anon;
