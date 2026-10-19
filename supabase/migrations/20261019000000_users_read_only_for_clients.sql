-- =============================================================================
-- Phare — users is READ-ONLY for signed-in users. 2026-10-19.
--
-- STATUS: APPLIED — 2026-10-19 (Lineu, SQL Editor).
--
--   VERIFIED LIVE 2026-10-19 through the read-only MCP server: VERIFY below
--   8/8 PASS (before applying: 4 FAIL / 4 PASS).
--   BEHAVIOUR VERIFIED LIVE 2026-10-19 over PostgREST as Zezinho Test
--   (publishable key + its own JWT): READ own row 200; PATCH household_id,
--   role and terms_version, each to its CURRENT value, 403 / 42501; DELETE
--   403 / 42501. Row unchanged (updated_at 2026-10-10 01:45:24 before and
--   after).
--
-- Launch plan item 1.2 (docs/launch-plan.md, Phase 1). Approved by Lineu
-- 2026-10-19.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-19:
--
--   policy "Users see own profile"  FOR ALL (cmd = *)  TO public
--     USING (id = auth.uid())   — no separate WITH CHECK
--   authenticated and anon: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
--
-- So any signed-in person can PATCH their OWN users row through PostgREST,
-- with the publishable key and their own session, and change any column:
--   - household_id: every other table's policy grants access by
--     "household_id = (SELECT household_id FROM users WHERE id = auth.uid())",
--     so pointing it at another household's id hands over that household's
--     accounts, transactions, letters — read and write;
--   - role = 'owner': unlocks the owner-only routes (checkout, promote,
--     remove members, delete the whole household);
--   - terms_accepted_at / terms_version: fakes consent.
-- No abuse found (no migration can tell after the fact; see the ticket for
-- the read-only checks that were run).
--
-- WHO LEGITIMATELY WRITES users, checked in code and in pg_proc:
--   - handle_new_user (sign-up)        SECURITY DEFINER: runs as its owner
--   - POST /api/legal/accept           createAdminClient (service role)
--   - POST /api/household/members/[id]/promote   createAdminClient
--   - account / household deletion    admin client and admin.rpc(...)
-- None is `authenticated` or `anon`, so none is affected. Every user-session
-- access to users is a SELECT of the caller's own row, which stays.
--
-- WHAT THIS DOES (same shape as 20261016000000_households_read_only_for_clients):
--   1. Revokes every write privilege on users from anon and authenticated,
--      at table AND column level (column grants survive a table REVOKE).
--      anon also loses SELECT: it never had a row to see (auth.uid() is null).
--   2. Replaces the FOR ALL policy with FOR SELECT TO authenticated, same
--      USING clause.
-- =============================================================================

BEGIN;

-- 1. Privileges ----------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.users FROM anon, authenticated;
REVOKE SELECT ON public.users FROM anon;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.users FROM anon, authenticated',
                   col, col, col);
    EXECUTE format('REVOKE SELECT (%I) ON public.users FROM anon', col);
  END LOOP;
END $$;

-- 2. Policy --------------------------------------------------------------------

DROP POLICY IF EXISTS "Users see own profile" ON public.users;
-- The name in 20260618000000_initial_schema.sql, in case it exists.
DROP POLICY IF EXISTS "users_all" ON public.users;

CREATE POLICY "users_select_own" ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: one row per check, every `result` = PASS.
-- =============================================================================
--
-- WITH cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- checks AS (
--   SELECT 'authenticated has no INSERT/UPDATE/DELETE/TRUNCATE on users' AS check_name,
--          NOT (has_table_privilege('authenticated', 'public.users', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.users', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.users', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.users', 'TRUNCATE')) AS ok
--   UNION ALL
--   SELECT 'anon has no privilege at all on users',
--          NOT (has_table_privilege('anon', 'public.users', 'SELECT')
--            OR has_table_privilege('anon', 'public.users', 'INSERT')
--            OR has_table_privilege('anon', 'public.users', 'UPDATE')
--            OR has_table_privilege('anon', 'public.users', 'DELETE')
--            OR has_table_privilege('anon', 'public.users', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of users is INSERT/UPDATE-able by authenticated or anon (household_id and role included)',
--          NOT EXISTS (SELECT 1 FROM cols
--                       WHERE has_column_privilege('authenticated', 'public.users', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.users', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.users', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.users', col, 'INSERT'))
--   UNION ALL
--   SELECT 'authenticated can still SELECT users',
--          has_table_privilege('authenticated', 'public.users', 'SELECT')
--   UNION ALL
--   SELECT 'exactly one policy on users, SELECT-only, to authenticated',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.users'::regclass) = 1
--      AND (SELECT polcmd FROM pg_policy WHERE polrelid = 'public.users'::regclass) = 'r'
--      AND (SELECT polroles = ARRAY['authenticated'::regrole]::oid[] FROM pg_policy WHERE polrelid = 'public.users'::regclass)
--   UNION ALL
--   SELECT 'row level security still enabled on users',
--          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass)
--   UNION ALL
--   SELECT 'service_role can still write users (terms, promote, deletion)',
--          has_table_privilege('service_role', 'public.users', 'UPDATE')
--   UNION ALL
--   SELECT 'handle_new_user is still SECURITY DEFINER (sign-up inserts users)',
--          (SELECT bool_and(prosecdef) FROM pg_proc WHERE proname = 'handle_new_user')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key + its own
-- session, over PostgREST): READ own users row → 200, 1 row; PATCH
-- household_id to its CURRENT value, role to its CURRENT value, and
-- terms_version to its CURRENT value → each refused 403 / 42501; the row
-- unchanged (updated_at identical). No value that differs from the stored one
-- is ever sent, so even a still-open hole could not change anything.
