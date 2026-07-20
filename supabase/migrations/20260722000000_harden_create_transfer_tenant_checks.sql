-- =============================================================================
-- Phare — create_transfer RPC: enforce tenant integrity inside the function
-- Applied 2026-07-22. Codex adversarial review, Tier 1.
--
-- PROBLEM: create_transfer trusted every caller-supplied ID. SECURITY INVOKER
-- + the transactions_all RLS policy (household_id = auth_household_id())
-- blocks a caller from spoofing p_household_id to someone else's household —
-- but it does NOT stop a caller who supplies their OWN real p_household_id
-- (which passes RLS) alongside p_chequing_id/p_goal_id belonging to a
-- DIFFERENT household. Nothing in the function checked that the two account
-- IDs actually belong to p_household_id, so a transaction row could be
-- written with household_id = the caller's own (real, RLS-legal) household
-- but account_id pointing at another household's account — poisoning that
-- account's balance (computeGoalBalance sums by account_id, not by which
-- household "owns" the row) from outside. Every current caller (transfers/
-- route.ts, recurring/route.ts, recurring/[id]/route.ts) already validates
-- this at the application layer — this migration makes the RPC enforce it
-- independently, since an RPC is a security boundary of its own: any bug in
-- a future caller, or a direct client-side supabase.rpc('create_transfer', …)
-- call (nothing today revokes EXECUTE), would otherwise bypass every check.
--
-- All new checks RAISE EXCEPTION (fail loudly — the standing rule here is
-- that silent failure is worse than visible failure). Signature is UNCHANGED
-- (still the 8-parameter version from 20260719000000) so CREATE OR REPLACE
-- correctly replaces in place — no DROP needed this time.
-- =============================================================================

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
  v_goal_id       uuid;
  v_chq_id        uuid;
  v_chequing_type text;
  v_goal_type     text;
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

  -- ── Insert the atomic pair ─────────────────────────────────────────────

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

-- ── EXECUTE privilege ─────────────────────────────────────────────────────
-- The only intended gateway is the three server-side API routes above, all
-- of which call this RPC through the authenticated Supabase client (the
-- `authenticated` role). Grepping the client bundle (src/components,
-- src/app/[locale]) found zero direct supabase.rpc('create_transfer', …)
-- calls — every call site is a Next.js API route. Revoking EXECUTE from
-- `anon` closes the unauthenticated path entirely (an anon caller couldn't
-- satisfy the household_members/accounts checks above anyway, since RLS on
-- those tables also requires auth_household_id() — but revoking removes the
-- attack surface outright rather than relying on that). `authenticated` KEEPS
-- EXECUTE: the API routes run with the signed-in user's session (the Supabase
-- server client forwards the user's JWT), so revoking from `authenticated`
-- would break the app's own transfer flow, not just a hypothetical attacker.
REVOKE EXECUTE ON FUNCTION create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid) FROM anon;
