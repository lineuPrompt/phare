-- =============================================================================
-- Phare — household_members: members read, only the server writes.
-- member_deletion_requests: server only. 2026-10-20.
--
-- STATUS: WRITTEN — not applied.
--
-- ORDER MATTERS — APPLY ONLY AFTER THE CODE IS LIVE ON phare.money (not just
-- pushed). The code change in the same commit moves the last member-session
-- writes of household_members to the service role:
--   POST /api/household/members/quick-add     insert (name-only member)
--   POST /api/household/members/[id]/resend   last_resend_at stamp
--   POST /api/household/members               attach-on-invite: the name read,
--                                             the update, the trigger-duplicate
--                                             lookup and its delete
-- Each now filters by the caller's household_id itself (the service role
-- bypasses RLS). Applying this before the code is live would make quick-add,
-- resend and invite-attach fail. Claude Code confirms from the Supabase edge
-- logs that the new code is serving before Lineu applies.
--
-- Launch plan item 1.4 (docs/launch-plan.md). Approved by Lineu 2026-10-20.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-20:
--   household_members
--     policy "Users see household members"  FOR ALL  TO public
--       USING (household_id IN (SELECT users.household_id FROM users WHERE users.id = auth.uid()))
--       no WITH CHECK
--     anon and authenticated: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
--   member_deletion_requests
--     policy "member_deletion_requests_household_all"  FOR ALL  TO public
--       USING (household_id = (SELECT users.household_id FROM users WHERE users.id = auth.uid()))
--     anon and authenticated: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
-- Any member, with their own session over PostgREST, could:
--   - set user_id on a member row (attach any login to any member, including
--     a tombstoned one), rename members, clear deleted_at, reset
--     last_resend_at to skip the resend rate limit;
--   - delete or add member rows;
--   - read, forge or erase the deletion audit trail of their household.
--
-- WHO NEEDS WHAT (checked 2026-10-20):
--   household_members — member sessions READ it in many routes (members list,
--     expenses, transfers, recurring, timeline, save-plan, accounts, promote,
--     remove, and create_transfer, which runs as the caller). Kept: SELECT,
--     scoped to the member's own household. Every write is the service role
--     (routes above, delete_household_member via admin.rpc) or
--     handle_new_user (SECURITY DEFINER). The mobile app never queries it.
--   member_deletion_requests — every read and write is the admin client
--     (/api/me, /api/household) or a function the admin client calls. No
--     member session touches it. Removed entirely, SELECT included.
--
-- AFTER THIS:
--   household_members: authenticated has SELECT only (table level), through a
--     FOR SELECT policy with the same household scope as before. anon has
--     nothing. No column-level write grant left.
--   member_deletion_requests: no privilege at all for authenticated or anon,
--     no policy. RLS stays ON, so every non-service role sees nothing.
--   The service role is unaffected on both.
-- =============================================================================

BEGIN;

-- ---- household_members ------------------------------------------------------

REVOKE ALL PRIVILEGES ON public.household_members FROM anon, authenticated;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.household_members'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.household_members FROM anon, authenticated',
                   col, col, col, col);
  END LOOP;
END $$;

GRANT SELECT ON public.household_members TO authenticated;

DROP POLICY IF EXISTS "Users see household members" ON public.household_members;
-- The name in 20260618000000_initial_schema.sql, in case it exists.
DROP POLICY IF EXISTS "household_members_all" ON public.household_members;

CREATE POLICY "household_members_select_own_household"
  ON public.household_members
  FOR SELECT
  TO authenticated
  USING (household_id IN (SELECT users.household_id FROM public.users WHERE users.id = auth.uid()));

-- ---- member_deletion_requests -----------------------------------------------

REVOKE ALL PRIVILEGES ON public.member_deletion_requests FROM anon, authenticated;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.member_deletion_requests'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.member_deletion_requests FROM anon, authenticated',
                   col, col, col, col);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "member_deletion_requests_household_all" ON public.member_deletion_requests;

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS.
-- =============================================================================
--
-- WITH hm_cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.household_members'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- mdr_cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.member_deletion_requests'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- checks AS (
--   SELECT 'authenticated can read household_members' AS check_name,
--          has_table_privilege('authenticated', 'public.household_members', 'SELECT') AS ok
--   UNION ALL
--   SELECT 'authenticated cannot write household_members',
--          NOT (has_table_privilege('authenticated', 'public.household_members', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.household_members', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.household_members', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.household_members', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'anon has no privilege at all on household_members',
--          NOT (has_table_privilege('anon', 'public.household_members', 'SELECT')
--            OR has_table_privilege('anon', 'public.household_members', 'INSERT')
--            OR has_table_privilege('anon', 'public.household_members', 'UPDATE')
--            OR has_table_privilege('anon', 'public.household_members', 'DELETE')
--            OR has_table_privilege('anon', 'public.household_members', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of household_members is writable by authenticated or anon, nor readable by anon',
--          NOT EXISTS (SELECT 1 FROM hm_cols
--                       WHERE has_column_privilege('authenticated', 'public.household_members', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.household_members', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.household_members', col, 'SELECT')
--                          OR has_column_privilege('anon', 'public.household_members', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.household_members', col, 'INSERT'))
--   UNION ALL
--   SELECT 'household_members has exactly one policy: SELECT to authenticated, own household',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.household_members'::regclass) = 1
--      AND EXISTS (SELECT 1 FROM pg_policy p
--                   WHERE p.polrelid = 'public.household_members'::regclass
--                     AND p.polname = 'household_members_select_own_household'
--                     AND p.polcmd = 'r'
--                     AND p.polroles = ARRAY['authenticated'::regrole::oid]
--                     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%auth.uid()%')
--   UNION ALL
--   SELECT 'authenticated has no privilege at all on member_deletion_requests',
--          NOT (has_table_privilege('authenticated', 'public.member_deletion_requests', 'SELECT')
--            OR has_table_privilege('authenticated', 'public.member_deletion_requests', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.member_deletion_requests', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.member_deletion_requests', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.member_deletion_requests', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'anon has no privilege at all on member_deletion_requests',
--          NOT (has_table_privilege('anon', 'public.member_deletion_requests', 'SELECT')
--            OR has_table_privilege('anon', 'public.member_deletion_requests', 'INSERT')
--            OR has_table_privilege('anon', 'public.member_deletion_requests', 'UPDATE')
--            OR has_table_privilege('anon', 'public.member_deletion_requests', 'DELETE')
--            OR has_table_privilege('anon', 'public.member_deletion_requests', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of member_deletion_requests is readable or writable by authenticated or anon',
--          NOT EXISTS (SELECT 1 FROM mdr_cols
--                       WHERE has_column_privilege('authenticated', 'public.member_deletion_requests', col, 'SELECT')
--                          OR has_column_privilege('authenticated', 'public.member_deletion_requests', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.member_deletion_requests', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.member_deletion_requests', col, 'SELECT')
--                          OR has_column_privilege('anon', 'public.member_deletion_requests', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.member_deletion_requests', col, 'INSERT'))
--   UNION ALL
--   SELECT 'no policy left on member_deletion_requests',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.member_deletion_requests'::regclass) = 0
--   UNION ALL
--   SELECT 'row level security still enabled on both tables',
--          (SELECT bool_and(relrowsecurity) FROM pg_class
--            WHERE oid IN ('public.household_members'::regclass, 'public.member_deletion_requests'::regclass))
--   UNION ALL
--   SELECT 'service_role can still read and write both tables',
--          has_table_privilege('service_role', 'public.household_members', 'SELECT')
--      AND has_table_privilege('service_role', 'public.household_members', 'INSERT')
--      AND has_table_privilege('service_role', 'public.household_members', 'UPDATE')
--      AND has_table_privilege('service_role', 'public.household_members', 'DELETE')
--      AND has_table_privilege('service_role', 'public.member_deletion_requests', 'SELECT')
--      AND has_table_privilege('service_role', 'public.member_deletion_requests', 'INSERT')
--      AND has_table_privilege('service_role', 'public.member_deletion_requests', 'UPDATE')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key + its own
-- session):
--   - PostgREST SELECT of its own household_members → 200, its rows
--   - household_members INSERT / UPDATE / DELETE (filtered to a nonexistent
--     id; insert of an unchanged-shape row is NOT sent) → 403 / 42501
--   - member_deletion_requests SELECT → 403 / 42501
--   - GET /api/household/members → 200, members listed
--   - the household's member rows unchanged (count, max updated state)
