-- =============================================================================
-- Phare — categories: members read, only the server writes. 2026-10-21.
--
-- STATUS: APPLIED — 2026-10-21 (Lineu, SQL Editor), after the code shipped in
--   commit 1d39cd2.
--
--   VERIFIED LIVE 2026-10-21 through the read-only MCP server: VERIFY below
--   7/7 PASS (before applying: 4 FAIL / 3 PASS).
--   BEHAVIOUR VERIFIED LIVE as Zezinho Test (publishable key + own JWT):
--   SELECT own categories 200 (10 rows); INSERT (nonexistent household),
--   UPDATE and DELETE (nonexistent id) 403/42501; SELECT with no session
--   401/42501; GET /api/categories 200 with 10 categories. Rows unchanged
--   (10, same names).
--
-- ORDER MATTERS — APPLY ONLY AFTER THE CODE IS LIVE ON phare.money (Vercel
-- shows the deployment Ready, not just pushed). The code change in the same
-- commit moves both writers to the service role (src/lib/categoriesWriter.ts):
--   POST /api/categories   insert, after its Pro gate
--   POST /api/save-plan    seed of the fixed set (and the body's list is now
--                          ignored — docs/tickets/save-plan-client-chooses-seed-categories.md)
-- Applying this before the code is live would make adding a category and a
-- first onboarding's category seed fail.
--
-- Launch plan item 1.6, second fix. Approved by Lineu 2026-10-21.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-21:
--   policy "Users see household categories"  FOR ALL  TO public
--     USING (household_id IN (SELECT users.household_id FROM users WHERE users.id = auth.uid()))
--     no WITH CHECK
--   anon and authenticated: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
-- Any member, with their own session over PostgREST, could:
--   - insert categories on a free plan, past the Pro gate on custom ones;
--   - rename any category, relabelling every past transaction in it;
--   - delete a category: budgets, budget_alerts and card_envelope_items
--     cascade (closed cycles included), and transactions / recurring_items
--     lose their category (ON DELETE SET NULL) — a history rewrite.
-- No abuse found: 3 households, 10 categories each, all the standard set.
--
-- WHO NEEDS WHAT (checked 2026-10-21):
--   member sessions READ categories (GET /api/categories, card-envelope,
--   card-envelope grid, expenses, recurring, save-plan's existing-names read).
--   Nothing in the app renames or deletes a category. No SQL function writes
--   the table. The mobile app never queries it directly.
--
-- AFTER THIS: authenticated has SELECT only, through a FOR SELECT policy with
-- the same household scope as before. anon has nothing. No column-level write
-- grant left. RLS stays ON. The service role is unaffected.
-- =============================================================================

BEGIN;

REVOKE ALL PRIVILEGES ON public.categories FROM anon, authenticated;

DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.categories'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.categories FROM anon, authenticated',
                   col, col, col, col);
  END LOOP;
END $$;

GRANT SELECT ON public.categories TO authenticated;

DROP POLICY IF EXISTS "Users see household categories" ON public.categories;
-- The name in 20260618000000_initial_schema.sql, in case it exists.
DROP POLICY IF EXISTS "categories_all" ON public.categories;

CREATE POLICY "categories_select_own_household"
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (household_id IN (SELECT users.household_id FROM public.users WHERE users.id = auth.uid()));

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS (7 rows).
-- =============================================================================
--
-- WITH cols AS (
--   SELECT attname::text AS col FROM pg_attribute
--    WHERE attrelid = 'public.categories'::regclass AND attnum > 0 AND NOT attisdropped
-- ),
-- checks AS (
--   SELECT 'authenticated can read categories' AS check_name,
--          has_table_privilege('authenticated', 'public.categories', 'SELECT') AS ok
--   UNION ALL
--   SELECT 'authenticated cannot write categories',
--          NOT (has_table_privilege('authenticated', 'public.categories', 'INSERT')
--            OR has_table_privilege('authenticated', 'public.categories', 'UPDATE')
--            OR has_table_privilege('authenticated', 'public.categories', 'DELETE')
--            OR has_table_privilege('authenticated', 'public.categories', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'anon has no privilege at all on categories',
--          NOT (has_table_privilege('anon', 'public.categories', 'SELECT')
--            OR has_table_privilege('anon', 'public.categories', 'INSERT')
--            OR has_table_privilege('anon', 'public.categories', 'UPDATE')
--            OR has_table_privilege('anon', 'public.categories', 'DELETE')
--            OR has_table_privilege('anon', 'public.categories', 'TRUNCATE'))
--   UNION ALL
--   SELECT 'no column of categories is writable by authenticated or anon, nor readable by anon',
--          NOT EXISTS (SELECT 1 FROM cols
--                       WHERE has_column_privilege('authenticated', 'public.categories', col, 'UPDATE')
--                          OR has_column_privilege('authenticated', 'public.categories', col, 'INSERT')
--                          OR has_column_privilege('anon', 'public.categories', col, 'SELECT')
--                          OR has_column_privilege('anon', 'public.categories', col, 'UPDATE')
--                          OR has_column_privilege('anon', 'public.categories', col, 'INSERT'))
--   UNION ALL
--   SELECT 'categories has exactly one policy: SELECT to authenticated, own household',
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.categories'::regclass) = 1
--      AND EXISTS (SELECT 1 FROM pg_policy p
--                   WHERE p.polrelid = 'public.categories'::regclass
--                     AND p.polname = 'categories_select_own_household'
--                     AND p.polcmd = 'r'
--                     AND p.polroles = ARRAY['authenticated'::regrole::oid]
--                     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%auth.uid()%')
--   UNION ALL
--   SELECT 'row level security still enabled on categories',
--          (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.categories'::regclass)
--   UNION ALL
--   SELECT 'service_role can still read and write categories',
--          has_table_privilege('service_role', 'public.categories', 'SELECT')
--      AND has_table_privilege('service_role', 'public.categories', 'INSERT')
--      AND has_table_privilege('service_role', 'public.categories', 'UPDATE')
--      AND has_table_privilege('service_role', 'public.categories', 'DELETE')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key + its own
-- session):
--   - PostgREST SELECT of its own categories → 200, 10 rows
--   - INSERT (nonexistent household) / UPDATE / DELETE (nonexistent id) → 403 / 42501
--   - GET /api/categories → 200, 10 categories
--   - the household's category rows unchanged (count and names)
