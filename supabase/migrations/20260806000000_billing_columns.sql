-- =============================================================================
-- Phare — billing state on households. 2026-08-04.
--
-- STATUS: APPLIED — verified live in production on 2026-08-04, 9/9 checks PASS.
--   All six columns present with the expected types and nullability;
--   subscription_cancel_at_period_end NOT NULL defaulting false;
--   idx_households_comped present; NO is_pro column exists (entitlement stays
--   derived); and no household reads as entitled — every comp_until,
--   stripe_subscription_id and subscription_current_period_end is still NULL,
--   which is the correct state before any billing code exists.
--
--   Superseded banner, kept as history — until 2026-08-04 this file read:
--     "PENDING APPLICATION — do not apply to production without founder
--      sign-off."
--
-- Piece 1 of the payment build. Columns only: nothing reads them yet, no Stripe
-- code exists, and applying this changes no behaviour. That is deliberate — the
-- schema has to exist before Case A can cancel a subscription (piece 2), and
-- piece 2 has to exist before checkout can ever create one (piece 4).
--
-- WHAT WAS ALREADY HERE, AND WHY IT IS NOT ENOUGH
--   households.subscription_status  text DEFAULT 'trial'
--     CHECK (status IN ('trial','active','cancelled','expired'))
--   households.stripe_customer_id   text
-- Both have been unread by any code since they were created. Two problems:
--
--   1. NO PERIOD END. The Terms promise that cancelling keeps access "for the
--      rest of the period you have already paid for". Without an end date that
--      sentence cannot be honoured — you can only know someone cancelled, not
--      when their access should actually stop.
--
--   2. 'cancelled' IS A TRAP. In Stripe, a subscription cancelled mid-period
--      stays status='active' with cancel_at_period_end=true until the period
--      ends. A naive "cancelled means no access" reading would take back access
--      the household paid for — breaking the Terms in the customer's disfavour,
--      which is the worst direction to get this wrong.
--
-- ENTITLEMENT IS DERIVED, NEVER STORED. There is deliberately no `is_pro`
-- column. A stored boolean is a cache of Stripe's state, and every cache of
-- someone else's truth eventually diverges from it — usually silently, usually
-- in the direction of granting or denying access wrongly. src/lib/entitlement.ts
-- computes it from the columns below on every read. Nothing to drift.
--
-- subscription_status is left exactly as it is: still unread, still defaulting
-- to 'trial'. Piece 5 (webhook) will begin writing Stripe's own status strings
-- into it. It is NOT used for comps — see below.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Stripe-mirrored state. Written ONLY by the webhook (piece 5). Every column
-- here is a copy of something Stripe owns; none of it is authoritative.
-- ---------------------------------------------------------------------------

-- The subscription itself, needed to cancel it. Case A deletion (piece 2) reads
-- this BEFORE dropping the household, because the cascade destroys it and there
-- is then no way to find the subscription that is still billing a customer for
-- a household that no longer exists.
ALTER TABLE households ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- When paid access actually ends. The load-bearing column for the Terms'
-- "access until the end of the period you paid for".
ALTER TABLE households ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz;

-- Stripe's cancel_at_period_end. Distinguishes "cancelled, still entitled until
-- period end" from "cancelled and over" — the distinction subscription_status
-- alone cannot express.
ALTER TABLE households ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean NOT NULL DEFAULT false;

-- Which price they are on (monthly vs annual). Recorded so an invoice question
-- can be answered without a Stripe round-trip.
ALTER TABLE households ADD COLUMN IF NOT EXISTS plan_price_id text;

-- ---------------------------------------------------------------------------
-- Comped access. NOT Stripe state.
--
-- Kept in its own columns rather than overloading subscription_status='trial',
-- and that separation is the whole point: a comped household has NO Stripe
-- objects at all, so no webhook can contradict it, no invoice can fail against
-- it, and no reconciliation can "repair" it. Comp and paid are independent
-- paths that cannot corrupt each other.
--
-- A DATE, not a boolean, so it expires by itself with no cleanup job. Entitlement
-- checks comp FIRST, so a comped family is unaffected by billing state entirely.
-- On expiry they drop silently to free — they keep everything except the full
-- review, which is honest and non-punitive.
-- ---------------------------------------------------------------------------
ALTER TABLE households ADD COLUMN IF NOT EXISTS comp_until  date;

-- Why they were comped ("founding trial 2026-11", "support goodwill", …).
-- At 15 households you will not remember who or why by next November.
ALTER TABLE households ADD COLUMN IF NOT EXISTS comp_reason text;

-- The gate's question is "is this household entitled right now?", asked on
-- essentially every authenticated request. Both lookups are by household id,
-- which is already the primary key — no index needed on that path. This partial
-- index serves the OPERATIONAL question instead: "who is currently comped?",
-- which is the one the founder will actually run in SQL.
CREATE INDEX IF NOT EXISTS idx_households_comped
  ON households (comp_until)
  WHERE comp_until IS NOT NULL;

-- =============================================================================
-- VERIFY — run after applying. Expect every row PASS.
-- =============================================================================
--
-- WITH checks AS (
--   SELECT 'stripe_subscription_id (text, nullable)' AS check_name,
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='stripe_subscription_id'
--                  AND data_type='text' AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END AS status
--   UNION ALL
--   SELECT 'subscription_current_period_end (timestamptz, nullable)',
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='subscription_current_period_end'
--                  AND data_type='timestamp with time zone' AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'subscription_cancel_at_period_end (bool, NOT NULL, default false)',
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='subscription_cancel_at_period_end'
--                  AND data_type='boolean' AND is_nullable='NO'
--                  AND column_default LIKE '%false%')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'plan_price_id (text, nullable)',
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='plan_price_id' AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'comp_until (date, nullable)',
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='comp_until' AND data_type='date'
--                  AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'comp_reason (text, nullable)',
--          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name='comp_reason' AND is_nullable='YES')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'idx_households_comped present',
--          CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
--                WHERE schemaname='public' AND indexname='idx_households_comped')
--               THEN 'PASS' ELSE 'FAIL' END
--   UNION ALL
--   SELECT 'NO is_pro column was created (entitlement must stay derived)',
--          CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_schema='public' AND table_name='households'
--                  AND column_name IN ('is_pro','pro','is_subscribed'))
--               THEN 'PASS' ELSE 'FAIL — a stored entitlement flag will drift' END
--   UNION ALL
--   SELECT 'no household is accidentally entitled yet',
--          CASE WHEN NOT EXISTS (SELECT 1 FROM households
--                WHERE comp_until IS NOT NULL
--                   OR stripe_subscription_id IS NOT NULL
--                   OR subscription_current_period_end IS NOT NULL)
--               THEN 'PASS' ELSE 'FAIL — someone already reads as Pro' END
-- )
-- SELECT * FROM checks ORDER BY status, check_name;
--
-- -- Current state of every household (expect both of yours, all NULL/false):
-- SELECT name, subscription_status, stripe_customer_id, stripe_subscription_id,
--        subscription_current_period_end, subscription_cancel_at_period_end,
--        plan_price_id, comp_until, comp_reason
--   FROM households ORDER BY created_at;
--
-- -- HOW TO COMP A HOUSEHOLD (piece 1 ships no UI for this, by design):
-- --   UPDATE households
-- --      SET comp_until = DATE '2027-11-01',
-- --          comp_reason = 'founding trial 2026-11'
-- --    WHERE id = '<household id>';
-- =============================================================================
