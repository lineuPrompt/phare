-- =============================================================================
-- Phare — create_transfer: a draw may come from a savings goal, not only a debt.
-- 2026-10-27.
--
-- STATUS: WRITTEN — not applied. Lineu applies it in the SQL Editor.
--
-- THE GAP. A household could put money into its Reserve Fund or a savings
-- goal but never take it back out to chequing: create_transfer refused a
-- 'draw' against anything but a debt account ("withdrawing from a savings-
-- style goal ... a different, unbuilt feature"). Lineu, 2026-10-27: a launch
-- blocker, and it must work exactly as the credit line does.
--
-- THE CHANGE. One clause. A draw is now allowed against every goal type
-- (savings, tfsa, rrsp, debt) — the same type list the function already
-- accepts as a destination. Nothing else moves:
--   * the stored pair is the same: both rows carry -p_amount (the existing
--     sign convention, 20260801000000) — the goal balance drops, chequing
--     rises, computeGoalBalance and the Timeline need no change;
--   * the app tells the two apart by the goal-side row's account type: a
--     draw from a debt account is borrowed, a draw from a savings-type
--     account is withdrawn (computeMonthTotals, dashboardHelpers.ts). Both
--     stay out of netCashFlow.
--   * a withdrawal larger than the account's balance is refused by POST
--     /api/transfers, before this function is reached.
--
-- SAME SIGNATURE, so CREATE OR REPLACE replaces the function in place (no
-- overload) and keeps its grants (20261020010000: authenticated and
-- service_role only). Because an unchanged signature can silently keep an
-- old body if the editor sends a truncated one, the VERIFY block below
-- checks every clause of the body, the signature count and the grants.
--
-- BEFORE (live, read-only MCP, 2026-10-27): one create_transfer,
--   (uuid,uuid,uuid,uuid,numeric,date,text,uuid,text), SECURITY INVOKER,
--   search_path=public, ACL {postgres, authenticated, service_role},
--   md5(prosrc) 284a5e18932479887543b8ce3a2a6286, length 4315.
-- =============================================================================

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

  -- A draw moves money from the goal account back to chequing: borrowing
  -- against a debt account, or withdrawing from a savings-type one (the
  -- Reserve Fund included). Every goal type above may be drawn from
  -- (2026-10-27). The app classifies the two by this account's type.

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

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS (8 rows). Before applying, row 3 FAILS
-- (the debt-only clause is still there) and every other row PASSES.
-- =============================================================================
--
-- WITH f AS (
--   SELECT p.oid, p.prosrc, p.prosecdef, p.proconfig, p.proacl
--     FROM pg_proc p WHERE p.proname = 'create_transfer'
-- ),
-- checks AS (
--   SELECT 'exactly one create_transfer, the 9-argument signature' AS check_name,
--          (SELECT count(*) FROM f) = 1
--      AND (SELECT oid::regprocedure::text FROM f) = 'create_transfer(uuid,uuid,uuid,uuid,numeric,date,text,uuid,text)' AS ok
--   UNION ALL
--   SELECT 'kind check kept (contribution or draw only)',
--          (SELECT prosrc LIKE '%p_kind NOT IN (''contribution'', ''draw'')%' FROM f)
--   UNION ALL
--   SELECT 'debt-only draw clause removed',
--          (SELECT prosrc NOT LIKE '%draws are only valid against a debt account%' FROM f)
--   UNION ALL
--   SELECT 'tenant checks kept (member, chequing, goal type)',
--          (SELECT prosrc LIKE '%does not belong to household%'
--              AND prosrc LIKE '%is not a chequing account%'
--              AND prosrc LIKE '%NOT IN (''savings'', ''tfsa'', ''rrsp'', ''debt'')%' FROM f)
--   UNION ALL
--   SELECT 'sign convention kept (draw stores -p_amount)',
--          (SELECT prosrc LIKE '%CASE WHEN p_kind = ''draw'' THEN -p_amount ELSE p_amount END%' FROM f)
--   UNION ALL
--   SELECT 'both rows inserted and the peer link closed',
--          (SELECT prosrc LIKE '%RETURNING id INTO v_goal_id%'
--              AND prosrc LIKE '%RETURNING id INTO v_chq_id%'
--              AND prosrc LIKE '%SET transfer_peer_id = v_chq_id%' FROM f)
--   UNION ALL
--   SELECT 'SECURITY INVOKER with search_path=public',
--          (SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM f)
--   UNION ALL
--   SELECT 'grants unchanged: authenticated + service_role, not anon or PUBLIC',
--          (SELECT has_function_privilege('authenticated', oid, 'EXECUTE')
--              AND has_function_privilege('service_role', oid, 'EXECUTE')
--              AND NOT has_function_privilege('anon', oid, 'EXECUTE')
--              AND NOT (proacl::text LIKE '%{=X%' OR proacl::text LIKE '%,=X%') FROM f)
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code, as Zezinho Test only):
--   - withdraw from its Reserve Fund through POST /api/transfers → 200; the
--     Reserve balance drops, the Timeline shows the money arriving;
--   - a withdrawal larger than the balance → 400 INSUFFICIENT_BALANCE;
--   - delete the probe pair afterwards.
