-- =============================================================================
-- Phare — fix create_transfer overload ambiguity (Build 4 Phase 3 round 2)
-- Applied 2026-07-19.
--
-- ROOT CAUSE of the live "Failed to create transfer" error on one-off
-- transfers (e.g. Goals page "Make a payment" on a debt account):
--
-- 20260717000000_recurring_transfers.sql added an 8th parameter
-- (p_recurring_item_id) to create_transfer via CREATE OR REPLACE FUNCTION.
-- PostgreSQL only replaces a function when an EXISTING function has the
-- EXACT SAME parameter type signature — adding a genuinely new parameter
-- changes the signature, so instead of replacing the original 7-parameter
-- function, Postgres created a SECOND, separate overload alongside it.
-- The household ended up with both:
--   create_transfer(uuid, uuid, uuid, uuid, numeric, date, text)              -- original
--   create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid DEFAULT NULL) -- Phase 2
--
-- Any RPC call using named parameters WITHOUT p_recurring_item_id (every
-- one-off transfer — /api/transfers/route.ts never sends it) matches BOTH
-- overloads: the 7-arg one exactly, and the 8-arg one via its default. That
-- is a genuine ambiguous-function-call error (Postgres 42725, "function ...
-- is not unique") — which the API layer's generic catch-all message
-- swallowed as "Failed to create transfer", hiding the real cause. Recurring
-- transfer materialization never hit this because it always sends all 8
-- named parameters, matching only the 8-arg overload.
--
-- FIX: drop the original 7-parameter overload by its exact signature,
-- leaving only the 8-parameter version (its default makes it callable with
-- 7 named args too, so both call sites keep working).
-- =============================================================================

DROP FUNCTION IF EXISTS create_transfer(uuid, uuid, uuid, uuid, numeric, date, text);

-- Re-affirm the 8-parameter version for idempotency (harmless if unchanged).
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

  UPDATE transactions
     SET transfer_peer_id = v_chq_id
   WHERE id = v_goal_id;

  RETURN jsonb_build_object(
    'chequing_row_id', v_chq_id,
    'goal_row_id',     v_goal_id
  );
END;
$$;
