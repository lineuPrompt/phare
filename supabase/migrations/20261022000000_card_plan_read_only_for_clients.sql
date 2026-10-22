-- =============================================================================
-- Phare — a card's plan (monthly_goals, card_envelope_items): members read,
-- only the server writes. 2026-10-22.
--
-- STATUS: WRITTEN — not applied.
--
-- ORDER MATTERS — APPLY ONLY AFTER THE CODE IS LIVE ON phare.money (Vercel
-- shows the deployment Ready, not just pushed). The code change in the same
-- commit moves every write of both tables to the service role
-- (src/lib/cardPlanWriter.ts), all in POST /api/card-envelope: the goal
-- upsert, the month's item delete + insert, and 'apply' removing later
-- months' plans. It also refuses categories that are not the household's own.
-- Applying this before the code is live would make saving a card's plan fail.
--
-- Launch plan item 1.6, third fix. Approved by Lineu 2026-10-22.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-22:
--   monthly_goals        policy "Users see household monthly goals"  FOR ALL  TO public
--   card_envelope_items  policy "card_envelope_items_all"            FOR ALL  TO public
--     both USING household scope via users.household_id, no WITH CHECK
--   anon and authenticated: SELECT, INSERT, UPDATE, DELETE, TRUNCATE on both
-- The closed-cycle lock (POST /api/card-envelope, 409 cycle_closed) is the
-- only thing keeping a closed statement's plan fixed. Any member, with their
-- own session over PostgREST, could insert, change or delete any month's goal
-- and category budgets — closed cycles included — rewriting history.
-- Live: 14 goal rows (3 households), 62 item rows. Neither table records edit
-- times, so past abuse cannot be ruled out from the data; nothing suggests it.
--
-- WHO NEEDS WHAT (checked 2026-10-22):
--   member sessions READ both tables (cardPlanServer, card-envelope GET and
--   grid, cards/months, timeline, save-plan). The only writer is POST
--   /api/card-envelope. No SQL function writes them. The mobile app never
--   queries them directly. Deleting a card removes its plan by FK cascade,
--   which runs as the table owner and is unaffected by member grants.
--
-- AFTER THIS, on both tables: authenticated has SELECT only, through a FOR
-- SELECT policy with the same household scope as before. anon has nothing. No
-- column-level write grant left. RLS stays ON. The service role is unaffected.
-- =============================================================================

BEGIN;

-- ---- monthly_goals ----------------------------------------------------------

REVOKE ALL PRIVILEGES ON public.monthly_goals FROM anon, authenticated;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.monthly_goals'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.monthly_goals FROM anon, authenticated',
                   col, col, col, col);
  END LOOP;
END $$;

GRANT SELECT ON public.monthly_goals TO authenticated;

DROP POLICY IF EXISTS "Users see household monthly goals" ON public.monthly_goals;
-- The name in 20260618000000_initial_schema.sql, in case it exists.
DROP POLICY IF EXISTS "monthly_goals_all" ON public.monthly_goals;

CREATE POLICY "monthly_goals_select_own_household"
  ON public.monthly_goals
  FOR SELECT
  TO authenticated
  USING (household_id IN (SELECT users.household_id FROM public.users WHERE users.id = auth.uid()));

-- ---- card_envelope_items ----------------------------------------------------

REVOKE ALL PRIVILEGES ON public.card_envelope_items FROM anon, authenticated;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.card_envelope_items'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.card_envelope_items FROM anon, authenticated',
                   col, col, col, col);
  END LOOP;
END $$;

GRANT SELECT ON public.card_envelope_items TO authenticated;

DROP POLICY IF EXISTS "card_envelope_items_all" ON public.card_envelope_items;

CREATE POLICY "card_envelope_items_select_own_household"
  ON public.card_envelope_items
  FOR SELECT
  TO authenticated
  USING (household_id IN (SELECT users.household_id FROM public.users WHERE users.id = auth.uid()));

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS (12 rows: 6 checks × 2 tables).
-- =============================================================================
--
-- WITH t(tbl, policy) AS (
--   VALUES ('monthly_goals', 'monthly_goals_select_own_household'),
--          ('card_envelope_items', 'card_envelope_items_select_own_household')
-- ),
-- checks AS (
--   SELECT tbl, 'authenticated can read' AS check_name,
--          has_table_privilege('authenticated', ('public.' || tbl)::regclass, 'SELECT') AS ok FROM t
--   UNION ALL
--   SELECT tbl, 'authenticated cannot write',
--          NOT (has_table_privilege('authenticated', ('public.' || tbl)::regclass, 'INSERT')
--            OR has_table_privilege('authenticated', ('public.' || tbl)::regclass, 'UPDATE')
--            OR has_table_privilege('authenticated', ('public.' || tbl)::regclass, 'DELETE')
--            OR has_table_privilege('authenticated', ('public.' || tbl)::regclass, 'TRUNCATE')) FROM t
--   UNION ALL
--   SELECT tbl, 'anon has no privilege at all',
--          NOT (has_table_privilege('anon', ('public.' || tbl)::regclass, 'SELECT')
--            OR has_table_privilege('anon', ('public.' || tbl)::regclass, 'INSERT')
--            OR has_table_privilege('anon', ('public.' || tbl)::regclass, 'UPDATE')
--            OR has_table_privilege('anon', ('public.' || tbl)::regclass, 'DELETE')
--            OR has_table_privilege('anon', ('public.' || tbl)::regclass, 'TRUNCATE')) FROM t
--   UNION ALL
--   SELECT tbl, 'no column writable by authenticated or anon, nor readable by anon',
--          NOT EXISTS (SELECT 1 FROM pg_attribute a
--                       WHERE a.attrelid = ('public.' || tbl)::regclass AND a.attnum > 0 AND NOT a.attisdropped
--                         AND (has_column_privilege('authenticated', ('public.' || tbl)::regclass, a.attname::text, 'UPDATE')
--                           OR has_column_privilege('authenticated', ('public.' || tbl)::regclass, a.attname::text, 'INSERT')
--                           OR has_column_privilege('anon', ('public.' || tbl)::regclass, a.attname::text, 'SELECT')
--                           OR has_column_privilege('anon', ('public.' || tbl)::regclass, a.attname::text, 'UPDATE')
--                           OR has_column_privilege('anon', ('public.' || tbl)::regclass, a.attname::text, 'INSERT'))) FROM t
--   UNION ALL
--   SELECT tbl, 'exactly one policy: SELECT to authenticated, own household',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = ('public.' || tbl)::regclass) = 1
--      AND EXISTS (SELECT 1 FROM pg_policy p
--                   WHERE p.polrelid = ('public.' || tbl)::regclass
--                     AND p.polname = t.policy
--                     AND p.polcmd = 'r'
--                     AND p.polroles = ARRAY['authenticated'::regrole::oid]
--                     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%auth.uid()%') FROM t
--   UNION ALL
--   SELECT tbl, 'RLS on, service_role can still read and write',
--          (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || tbl)::regclass)
--      AND has_table_privilege('service_role', ('public.' || tbl)::regclass, 'SELECT')
--      AND has_table_privilege('service_role', ('public.' || tbl)::regclass, 'INSERT')
--      AND has_table_privilege('service_role', ('public.' || tbl)::regclass, 'UPDATE')
--      AND has_table_privilege('service_role', ('public.' || tbl)::regclass, 'DELETE') FROM t
-- )
-- SELECT tbl, check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY tbl, check_name;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key + its own
-- session):
--   - PostgREST SELECT of its own rows in both tables → 200
--   - INSERT (nonexistent household) / UPDATE / DELETE (nonexistent id) on
--     both → 403 / 42501
--   - GET /api/card-envelope/grid → 200
--   - both tables' rows unchanged (counts and a checksum of the values)
