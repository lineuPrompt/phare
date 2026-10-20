-- =============================================================================
-- Phare — conversations: server only. Members can neither read nor write
-- letters directly. 2026-10-19.
--
-- STATUS: APPLIED — 2026-10-19 18:44 UTC (Lineu, SQL Editor).
--
--   APPLIED ~1 HOUR BEFORE THE CODE WENT LIVE. The commit was pushed, but the
--   Vercel deploy serving phare.money still ran the old member-session reads
--   until about 19:48 UTC (Supabase edge logs: authenticated 403 at 18:44, then
--   service_role 200 from 19:48). In that window /api/reviews answered 503 and
--   the dashboard showed no letter. No data was lost. Next time: confirm the
--   deploy is Ready on phare.money, not just pushed, before applying.
--
--   VERIFIED LIVE 2026-10-19 through the read-only MCP server: VERIFY below
--   6/6 PASS (before applying: 4 FAIL / 2 PASS).
--   BEHAVIOUR VERIFIED LIVE as Zezinho Test (publishable key + own JWT):
--   2026-10-19: PostgREST SELECT / INSERT / UPDATE / DELETE all 403/42501.
--   2026-10-20: direct SELECT still 403; GET /api/reviews 200 with all 3
--   monthly letters in full (comped, Pro); GET /api/dashboard 200 with its
--   letter. Letter rows unchanged: 13, newest updated_at 2026-10-11 18:00:34.
--
-- ORDER MATTERS — APPLY ONLY AFTER THE CODE IS DEPLOYED. The code change in
-- the same commit moves every remaining member-session read and write of
-- conversations to the service role (src/lib/conversationsClient.ts):
-- /api/reviews, /api/dashboard, /api/regenerate-plan, /api/save-plan. The
-- monthly-review cron already used the admin client. Applying this before the
-- code is live would make the review archive and the dashboard letter fail
-- (503) and stop regenerate and onboarding from saving letters.
--
-- Launch plan item 1.3 (docs/launch-plan.md). Approved by Lineu 2026-10-19.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-19:
--   policy "Users see household conversations"  FOR ALL  TO public
--     USING (household_id IN (SELECT users.household_id FROM users WHERE users.id = auth.uid()))
--   authenticated and anon: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
-- conversations holds the FULL text of every monthly review and onboarding
-- letter. The Pro cut-off for free households (reviewForEntitlement) happens
-- in the routes, so a free household could SELECT its whole letter over
-- PostgREST with its own session — and edit or delete its letters.
--
-- AFTER THIS: no privilege at all for authenticated or anon, at table and
-- column level; the FOR ALL policy dropped and none created. Row level
-- security stays ON, so with no policy every non-service role sees nothing.
-- The service role (routes and cron) is unaffected.
-- =============================================================================

BEGIN;

REVOKE ALL PRIVILEGES ON public.conversations FROM anon, authenticated;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.conversations'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.conversations FROM anon, authenticated',
                   col, col, col, col);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Users see household conversations" ON public.conversations;
-- The name in 20260618000000_initial_schema.sql, in case it exists.
DROP POLICY IF EXISTS "conversations_all" ON public.conversations;

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS.
-- =============================================================================
--
-- WITH cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.conversations'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- checks AS (
--   SELECT 'authenticated has no privilege at all on conversations' AS check_name,
--          NOT (has_table_privilege('authenticated', 'public.conversations', 'SELECT')
--            OR has_table_privilege('authenticated', 'public.conversations', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.conversations', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.conversations', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.conversations', 'TRUNCATE')) AS ok
--   UNION ALL
--   SELECT 'anon has no privilege at all on conversations',
--          NOT (has_table_privilege('anon', 'public.conversations', 'SELECT')
--            OR has_table_privilege('anon', 'public.conversations', 'INSERT')
--            OR has_table_privilege('anon', 'public.conversations', 'UPDATE')
--            OR has_table_privilege('anon', 'public.conversations', 'DELETE')
--            OR has_table_privilege('anon', 'public.conversations', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of conversations is readable or writable by authenticated or anon',
--          NOT EXISTS (SELECT 1 FROM cols
--                       WHERE has_column_privilege('authenticated', 'public.conversations', col, 'SELECT')
--                          OR has_column_privilege('authenticated', 'public.conversations', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.conversations', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.conversations', col, 'SELECT')
--                          OR has_column_privilege('anon', 'public.conversations', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.conversations', col, 'INSERT'))
--   UNION ALL
--   SELECT 'no policy left on conversations',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.conversations'::regclass) = 0
--   UNION ALL
--   SELECT 'row level security still enabled on conversations',
--          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conversations'::regclass)
--   UNION ALL
--   SELECT 'service_role can still read and write conversations (routes, cron)',
--          has_table_privilege('service_role', 'public.conversations', 'SELECT')
--      AND has_table_privilege('service_role', 'public.conversations', 'INSERT')
--      AND has_table_privilege('service_role', 'public.conversations', 'UPDATE')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key + its own
-- session):
--   - PostgREST SELECT of its own conversations → 403 / 42501
--   - INSERT / UPDATE / DELETE (filtered to a nonexistent id) → 403 / 42501
--   - GET /api/reviews → 200, letters present (Zezinho Test is comped: full)
--   - GET /api/dashboard → 200, review present
--   - the household's conversation rows unchanged (count and newest updated_at)
