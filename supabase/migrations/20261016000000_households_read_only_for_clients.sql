-- =============================================================================
-- Phare — households is READ-ONLY for signed-in users. 2026-10-16.
--
-- STATUS: APPLIED — 2026-10-16 (Lineu, SQL Editor: "Success. No rows
-- returned").
--
--   VERIFIED LIVE 2026-10-16 through the read-only MCP server: the VERIFY
--   query below, 7/7 PASS. Run before applying it gave 4 FAIL (the hole) and
--   3 PASS, so the checks can fail. Behaviour over PostgREST (a refused
--   PATCH as Zezinho Test): NOT YET RUN, awaiting Lineu's permission.
--
-- Ticket: docs/tickets/households-billing-columns-client-writable.md
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-16:
--
--   policy "Users see own household"  FOR ALL (cmd = *)
--     USING (id IN (SELECT household_id FROM users WHERE id = auth.uid()))
--
--   has_column_privilege('authenticated', 'public.households', <col>, 'UPDATE')
--     = true for comp_until, subscription_status,
--       subscription_current_period_end, subscription_cancel_at_period_end,
--       stripe_customer_id, stripe_subscription_id, name
--
-- So any signed-in member, with the publishable key and their own session,
-- could PATCH their own household row through PostgREST, for example set
-- comp_until = '2099-12-31', and entitlementFor would answer Pro on every
-- route. Or DELETE the row outright, skipping /api/household's ordered
-- teardown (Stripe cancellation first). No abuse found: every non-null
-- comp_until has a comp_reason Lineu wrote, and the only Stripe subscriptions
-- are 2be22642's and Zezinho Test's.
--
-- WHO LEGITIMATELY WRITES households, checked twice (Grep, then grep in Bash,
-- then pg_proc):
--   - the Stripe webhook                 createAdminClient (service role)
--   - handle_new_user                    SECURITY DEFINER (owner rights)
--   - delete_household (RPC, INVOKER)    called only as admin.rpc(...) from
--                                        src/app/api/household/route.ts
-- Service role and the function owner are not `authenticated`/`anon`, so
-- nothing here touches them. No route and no client writes households
-- through the user's own session; every user-session read is a SELECT
-- (entitlementServer, householdTimezone, the household gate), which stays.
--
-- WHAT THIS DOES
--   1. Revokes every write privilege on households from anon and
--      authenticated, at TABLE level and at COLUMN level. A table-level
--      REVOKE leaves column-level grants in place, so both are revoked.
--   2. Replaces the FOR ALL policy with a FOR SELECT policy, same USING
--      clause. A policy only filters; the privileges in (1) are what refuse.
--      Both are fixed, so a later stray GRANT is not enough on its own to
--      reopen the hole.
--
-- Not changed: SELECT for authenticated (the app reads its own household),
-- any privilege of service_role or postgres, and every other table. Other
-- tables with FOR ALL policies are a separate review (the events table is
-- already ticketed).
-- =============================================================================

BEGIN;

-- 1. Privileges ----------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.households FROM anon, authenticated;

-- Column-level grants survive a table-level REVOKE; remove those too.
DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.households'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.households FROM anon, authenticated',
                   col, col, col);
  END LOOP;
END $$;

-- 2. Policy --------------------------------------------------------------------

DROP POLICY IF EXISTS "Users see own household" ON public.households;
-- The names in 20260618000000_initial_schema.sql, in case either exists.
DROP POLICY IF EXISTS "households_select" ON public.households;
DROP POLICY IF EXISTS "households_update" ON public.households;

CREATE POLICY "households_select_own" ON public.households
  FOR SELECT TO authenticated
  USING (id IN (SELECT household_id FROM public.users WHERE id = auth.uid()));

COMMIT;

-- =============================================================================
-- VERIFY — run in the SQL Editor after applying, as its own run.
--
-- Read-only. Expected output: one row per check, every `result` = PASS.
-- =============================================================================
--
-- WITH cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.households'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- checks AS (
--   SELECT 'authenticated has no INSERT/UPDATE/DELETE/TRUNCATE on households' AS check_name,
--          NOT (has_table_privilege('authenticated', 'public.households', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.households', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.households', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.households', 'TRUNCATE')) AS ok
--   UNION ALL
--   SELECT 'anon has no INSERT/UPDATE/DELETE/TRUNCATE on households',
--          NOT (has_table_privilege('anon', 'public.households', 'INSERT')
--            OR has_table_privilege('anon', 'public.households', 'UPDATE')
--            OR has_table_privilege('anon', 'public.households', 'DELETE')
--            OR has_table_privilege('anon', 'public.households', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of households is INSERT/UPDATE-able by authenticated or anon',
--          NOT EXISTS (SELECT 1 FROM cols
--                       WHERE has_column_privilege('authenticated', 'public.households', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.households', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.households', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.households', col, 'INSERT'))
--   UNION ALL
--   SELECT 'authenticated can still SELECT households',
--          has_table_privilege('authenticated', 'public.households', 'SELECT')
--   UNION ALL
--   SELECT 'exactly one policy on households, and it is SELECT-only',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.households'::regclass) = 1
--      AND (SELECT polcmd FROM pg_policy WHERE polrelid = 'public.households'::regclass) = 'r'
--   UNION ALL
--   SELECT 'row level security is still enabled on households',
--          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.households'::regclass)
--   UNION ALL
--   SELECT 'service_role can still UPDATE households (Stripe webhook)',
--          has_table_privilege('service_role', 'public.households', 'UPDATE')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then a behaviour check over the real path (PostgREST, signed in as Zezinho
-- Test with the publishable key): a PATCH of Zezinho Test's own households
-- row, setting comp_until to the value it already has, must be refused
-- (HTTP 401/403, code 42501), and the row unchanged. Claude Code runs it
-- after Lineu reports VERIFY all PASS, with Lineu's permission first, since
-- it is a script.
