-- =============================================================================
-- Phare — events: members may READ their household's events; only the server
-- writes them. 2026-10-19.
--
-- STATUS: WRITTEN, NOT APPLIED.
--
-- ORDER MATTERS — APPLY ONLY AFTER THE CODE IS DEPLOYED. The code change in
-- the same commit moves every event write to the service role
-- (src/lib/eventWriter.ts): logEvent, the two AI-quota reservations, and
-- /api/events. Until that code is live, routes still insert with the member's
-- session; applying this first would make those inserts fail — analytics lost
-- silently, and the onboarding/regenerate quotas refusing every request
-- ("unavailable", fail-closed).
--
-- Launch plan item 1.1 (docs/launch-plan.md). Approved by Lineu 2026-10-19.
-- Ticket: docs/tickets/events-rls-client-writable.md.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-19:
--   policy events_all  FOR ALL  TO public
--     USING (household_id = (SELECT users.household_id FROM users WHERE users.id = auth.uid()))
--   authenticated and anon: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
-- Any signed-in member could, over PostgREST with their own session:
--   - DELETE the rows the AI spend limits count (onboarding_plan_generated,
--     onboarding_review_generated, review_regenerated) and reset their own
--     allowance;
--   - INSERT any event_type for their household, bypassing /api/events and
--     CLIENT_EVENT_ALLOWLIST (funnel and guard events).
--
-- AFTER THIS: members keep SELECT on their own household's rows (the quota
-- counts, isFirstEvent and isFirstReturnToday read with the member's
-- session). INSERT/UPDATE/DELETE/TRUNCATE are revoked from authenticated and
-- anon at table and column level; anon also loses SELECT.
-- =============================================================================

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.events FROM anon, authenticated;
REVOKE SELECT ON public.events FROM anon;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.events'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.events FROM anon, authenticated',
                   col, col, col);
    EXECUTE format('REVOKE SELECT (%I) ON public.events FROM anon', col);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "events_all" ON public.events;

CREATE POLICY "events_select_own_household" ON public.events
  FOR SELECT TO authenticated
  USING (household_id = (SELECT users.household_id FROM public.users WHERE users.id = auth.uid()));

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS.
-- =============================================================================
--
-- WITH cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.events'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- checks AS (
--   SELECT 'authenticated has no INSERT/UPDATE/DELETE/TRUNCATE on events' AS check_name,
--          NOT (has_table_privilege('authenticated', 'public.events', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.events', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.events', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.events', 'TRUNCATE')) AS ok
--   UNION ALL
--   SELECT 'anon has no privilege at all on events',
--          NOT (has_table_privilege('anon', 'public.events', 'SELECT')
--            OR has_table_privilege('anon', 'public.events', 'INSERT')
--            OR has_table_privilege('anon', 'public.events', 'UPDATE')
--            OR has_table_privilege('anon', 'public.events', 'DELETE')
--            OR has_table_privilege('anon', 'public.events', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of events is INSERT/UPDATE-able by authenticated or anon',
--          NOT EXISTS (SELECT 1 FROM cols
--                       WHERE has_column_privilege('authenticated', 'public.events', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.events', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.events', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.events', col, 'INSERT'))
--   UNION ALL
--   SELECT 'authenticated can still SELECT events (quota counts read with the session)',
--          has_table_privilege('authenticated', 'public.events', 'SELECT')
--   UNION ALL
--   SELECT 'exactly one policy on events, SELECT-only, to authenticated',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.events'::regclass) = 1
--      AND (SELECT polcmd FROM pg_policy WHERE polrelid = 'public.events'::regclass) = 'r'
--      AND (SELECT polroles = ARRAY['authenticated'::regrole]::oid[] FROM pg_policy WHERE polrelid = 'public.events'::regclass)
--   UNION ALL
--   SELECT 'row level security still enabled on events',
--          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.events'::regclass)
--   UNION ALL
--   SELECT 'service_role can still write events (eventWriter)',
--          has_table_privilege('service_role', 'public.events', 'INSERT')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key + its own
-- session, over PostgREST):
--   - INSERT an event row for its own household  → 403 / 42501, no row
--   - UPDATE / DELETE filtered to a row id that does not exist → 403 / 42501
--     (refused on privilege before any row is matched; nothing real is touched)
--   - POST /api/events with an allowlisted type   → 204, and the row appears
--   - GET /api/timeline?pageView=1                → a timeline_opened row appears
--   - the household's quota counts (onboarding_*_generated, review_regenerated)
--     identical before and after.
