-- =============================================================================
-- Phare — Apple (App Store) subscription state on households. 2026-10-16.
--
-- STATUS: APPLIED — 2026-10-16 (Lineu, SQL Editor).
--
--   VERIFIED LIVE 2026-10-16 through the read-only MCP server: VERIFY below
--   14/14 PASS (before applying, the same query gave 11 FAIL / 3 PASS). The
--   exact ENTITLEMENT_COLUMNS select from entitlementServer.ts runs against
--   the live table. 2be22642 still reads as Stripe 'active' and Zezinho Test
--   as 'comp', as before. No household has Apple state.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT READS IT. src/lib/entitlementServer.ts
-- selects these columns on every entitlement read. Against a database without
-- them that select fails, and loadEntitlement FAILS CLOSED: every household,
-- paying ones included, would read as free until this is applied.
--
-- WHY. In-app purchase, chosen by Lineu 2026-10-16 (BACKLOG). Pro is sold in
-- the iOS app through Apple as well as on the web through Stripe. These
-- columns mirror Apple's state exactly as the Stripe columns
-- (20260806000000_billing_columns.sql) mirror Stripe's: copies of someone
-- else's truth, written only by the server after it has verified Apple's
-- signed data. Entitlement stays DERIVED on every read (entitlementFor):
-- comp OR Stripe OR Apple. There is no is_pro column and there must not be one.
--
-- WHO WRITES THEM: only the server, as service_role (the Apple notification
-- webhook and the purchase-verification route, in-app purchase piece 2).
-- Members cannot: 20261016000000_households_read_only_for_clients.sql
-- revoked every client write on households at table level, which covers
-- columns added later. VERIFY checks that for these columns specifically.
--
-- WHAT APPLE CALLS THINGS (App Store Server API, subscription statuses):
--   1 active · 2 expired · 3 billing retry · 4 billing grace period · 5 revoked
-- Stored as words, not Apple's integers, so a SQL reader does not need the
-- table above.
-- =============================================================================

BEGIN;

-- The subscription's identity across renewals. One household holds at most one
-- Apple subscription, and one Apple subscription belongs to one household.
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_original_transaction_id text;

-- Which product (monthly or yearly), so a support question has an answer.
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_product_id text;

-- Apple's status, in words.
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_status text;

-- When the current paid period ends (Apple's expiresDate).
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_expires_at timestamptz;

-- While Apple retries a failed renewal with a billing grace period, access
-- continues until this date (Apple's gracePeriodExpiresDate). Null otherwise.
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_grace_period_expires_at timestamptz;

-- Apple's autoRenewStatus. false = the person turned renewal off: still Pro
-- until apple_expires_at, then not. The Apple counterpart of
-- subscription_cancel_at_period_end.
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_auto_renew boolean;

-- 'Production' or 'Sandbox'. Recorded, NOT gated on: TestFlight and App
-- Review both purchase in the sandbox, and App Review must get what it paid
-- for to approve the app.
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_environment text;

-- When Apple signed the newest state written here. A notification older than
-- this must not overwrite a newer one (the Stripe columns' subscription_updated_at rule).
ALTER TABLE households ADD COLUMN IF NOT EXISTS apple_updated_at timestamptz;

ALTER TABLE households DROP CONSTRAINT IF EXISTS households_apple_status_check;
ALTER TABLE households ADD CONSTRAINT households_apple_status_check
  CHECK (apple_status IS NULL OR apple_status IN ('active', 'expired', 'billing_retry', 'grace_period', 'revoked'));

ALTER TABLE households DROP CONSTRAINT IF EXISTS households_apple_environment_check;
ALTER TABLE households ADD CONSTRAINT households_apple_environment_check
  CHECK (apple_environment IS NULL OR apple_environment IN ('Production', 'Sandbox'));

-- One Apple subscription, one household.
CREATE UNIQUE INDEX IF NOT EXISTS idx_households_apple_original_transaction_id
  ON households (apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

COMMIT;

-- =============================================================================
-- VERIFY — run in the SQL Editor after applying, as its own run.
-- Read-only. Expected: every `result` = PASS.
-- =============================================================================
--
-- WITH want(col, typ) AS (VALUES
--   ('apple_original_transaction_id', 'text'),
--   ('apple_product_id', 'text'),
--   ('apple_status', 'text'),
--   ('apple_expires_at', 'timestamp with time zone'),
--   ('apple_grace_period_expires_at', 'timestamp with time zone'),
--   ('apple_auto_renew', 'boolean'),
--   ('apple_environment', 'text'),
--   ('apple_updated_at', 'timestamp with time zone')
-- ),
-- checks AS (
--   SELECT 'column ' || w.col || ' (' || w.typ || ', nullable)' AS check_name,
--          EXISTS (SELECT 1 FROM information_schema.columns c
--                   WHERE c.table_schema = 'public' AND c.table_name = 'households'
--                     AND c.column_name = w.col AND c.data_type = w.typ AND c.is_nullable = 'YES') AS ok
--     FROM want w
--   UNION ALL
--   SELECT 'members cannot write any Apple column',
--          -- CASE, not a join: Postgres may evaluate has_column_privilege before a
--          -- join filters, and it errors on a column that does not exist yet.
--          NOT EXISTS (SELECT 1 FROM want w
--                       WHERE CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
--                                                WHERE c.table_schema = 'public' AND c.table_name = 'households'
--                                                  AND c.column_name = w.col)
--                                  THEN has_column_privilege('authenticated', 'public.households', w.col, 'UPDATE')
--                                    OR has_column_privilege('authenticated', 'public.households', w.col, 'INSERT')
--                                    OR has_column_privilege('anon', 'public.households', w.col, 'UPDATE')
--                                  ELSE false END)
--   UNION ALL
--   SELECT 'service_role can write them (the webhook)',
--          has_table_privilege('service_role', 'public.households', 'UPDATE')
--   UNION ALL
--   SELECT 'apple_status check constraint present',
--          EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_apple_status_check')
--   UNION ALL
--   SELECT 'apple_environment check constraint present',
--          EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_apple_environment_check')
--   UNION ALL
--   SELECT 'unique index on apple_original_transaction_id',
--          EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_households_apple_original_transaction_id'
--                    AND indexdef ILIKE '%UNIQUE%')
--   UNION ALL
--   SELECT 'no household has Apple state yet',
--          NOT EXISTS (SELECT 1 FROM households h WHERE to_jsonb(h) ->> 'apple_status' IS NOT NULL
--                                                   OR to_jsonb(h) ->> 'apple_original_transaction_id' IS NOT NULL)
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
