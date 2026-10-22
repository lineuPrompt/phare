-- =============================================================================
-- Phare — a household's rows may only point at its own rows. 2026-10-22.
--
-- STATUS: WRITTEN — not applied.
--
-- NO CODE CHANGE, NO ORDERING. Safe to apply at any time: every live link
-- already points within its own household (scan below), and the app never
-- writes a cross-household link.
--
-- Launch plan item 1.6, fourth and last fix. Approved by Lineu 2026-10-22.
--
-- THE HOLE. Live, through the read-only MCP server, 2026-10-22. Members can
-- still write these 9 tables directly (by design: own-household data, RLS
-- scoped). RLS checks the row's own household_id, NOT the rows it points at,
-- so a member could insert, say, a recurring item whose account_id is another
-- household's account. 26 such links exist; only transactions had a guard
-- (20260928, trg_enforce_transaction_same_household_refs), covering 3 of its 7.
-- No read leak (RLS still hides the foreign row on every read). The real harm
-- is ON DELETE RESTRICT: a foreign recurring item pointing at a household's
-- account blocks that household from deleting the account — or itself
-- (erasure). Exploiting it needs the other household's internal ids.
--
-- LIVE DATA, 2026-10-22: zero cross-household links across all 26 (1,294
-- transactions, 52 recurring items scanned). Nothing to repair first.
--
-- AFTER THIS:
--   1. one guard function, public.enforce_same_household_refs(), attached as a
--      BEFORE INSERT OR UPDATE trigger to all 9 tables with that table's links
--      as trigger arguments ('column:target_table'). A non-null link must name
--      a row of the SAME household, else 42501 "<table>.<column> does not
--      belong to its household".
--      On UPDATE it checks only links whose value changed (or every link when
--      household_id itself changed). So the database's own ON DELETE SET NULL
--      updates never trip it — the old transactions guard re-checked every
--      link on those updates, which could refuse one during a cascade.
--      SECURITY DEFINER so its lookups see the target row regardless of the
--      writer's RLS, the same as the guard it replaces.
--   2. transactions' old 3-link trigger and its function are replaced by the
--      generic one with all 7 links.
--   3. hygiene: anon loses every privilege on the 11 tables where it still had
--      some (RLS already refused it); stripe_webhook_events becomes server-only
--      (RLS on, no policy — authenticated loses its grants too). The webhook
--      route uses the admin client.
-- =============================================================================

BEGIN;

-- ---- 1. the guard -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_same_household_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  spec      text;
  col       text;
  target    text;
  new_row   jsonb := to_jsonb(NEW);
  old_row   jsonb;
  ref       text;
  household text  := to_jsonb(NEW) ->> 'household_id';
  same      boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
  END IF;

  FOREACH spec IN ARRAY TG_ARGV LOOP
    col    := split_part(spec, ':', 1);
    target := split_part(spec, ':', 2);
    ref    := new_row ->> col;

    CONTINUE WHEN ref IS NULL;
    -- An unchanged link in an unchanged household was checked when written.
    CONTINUE WHEN TG_OP = 'UPDATE'
              AND ref IS NOT DISTINCT FROM (old_row ->> col)
              AND household IS NOT DISTINCT FROM (old_row ->> 'household_id');

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1::uuid AND household_id = $2::uuid)', target)
       INTO same
      USING ref, household;

    IF NOT same THEN
      RAISE EXCEPTION '%.% does not belong to its household', TG_TABLE_NAME, col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_same_household_refs() FROM PUBLIC, anon, authenticated;

-- ---- 2. one trigger per table -----------------------------------------------

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.account_balance_anchors;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.account_balance_anchors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('account_id:accounts');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.accounts;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('file_import_id:file_imports');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.budget_alerts;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.budget_alerts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('category_id:categories', 'member_id:household_members');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.budgets;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('category_id:categories', 'file_import_id:file_imports', 'member_id:household_members');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.file_imports;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.file_imports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('uploaded_by:users');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.recurring_items;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.recurring_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs(
    'account_id:accounts', 'category_id:categories', 'destination_account_id:accounts',
    'file_import_id:file_imports', 'member_id:household_members', 'predecessor_id:recurring_items');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.recurring_skipped_dates;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.recurring_skipped_dates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('recurring_item_id:recurring_items');

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.sinking_funds;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.sinking_funds
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs('file_import_id:file_imports', 'linked_account_id:accounts');

-- transactions: the 3-link guard of 20260928 is replaced by the full 7.
DROP TRIGGER IF EXISTS trg_enforce_transaction_same_household_refs ON public.transactions;
DROP FUNCTION IF EXISTS public.enforce_transaction_same_household_refs();

DROP TRIGGER IF EXISTS trg_enforce_same_household_refs ON public.transactions;
CREATE TRIGGER trg_enforce_same_household_refs
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_household_refs(
    'account_id:accounts', 'bridge_source_account:accounts', 'category_id:categories',
    'file_import_id:file_imports', 'member_id:household_members',
    'recurring_item_id:recurring_items', 'transfer_peer_id:transactions');

-- ---- 3. hygiene: signed-out callers have no use for these -------------------

DO $$
DECLARE
  tbl text;
  col text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['account_balance_anchors', 'accounts', 'budget_alerts', 'budgets', 'file_imports',
                             'households', 'recurring_items', 'recurring_skipped_dates', 'sinking_funds',
                             'stripe_webhook_events', 'transactions'] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON public.%I FROM anon', tbl);
    FOR col IN
      SELECT attname FROM pg_attribute
       WHERE attrelid = format('public.%I', tbl)::regclass AND attnum > 0 AND NOT attisdropped
    LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM anon',
                     col, col, col, col, tbl);
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON public.stripe_webhook_events FROM authenticated;

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS (14 rows).
-- =============================================================================
--
-- WITH expected(tbl, args) AS (
--   VALUES
--     ('account_balance_anchors', 'account_id:accounts'),
--     ('accounts',                'file_import_id:file_imports'),
--     ('budget_alerts',           'category_id:categories,member_id:household_members'),
--     ('budgets',                 'category_id:categories,file_import_id:file_imports,member_id:household_members'),
--     ('file_imports',            'uploaded_by:users'),
--     ('recurring_items',         'account_id:accounts,category_id:categories,destination_account_id:accounts,file_import_id:file_imports,member_id:household_members,predecessor_id:recurring_items'),
--     ('recurring_skipped_dates', 'recurring_item_id:recurring_items'),
--     ('sinking_funds',           'file_import_id:file_imports,linked_account_id:accounts'),
--     ('transactions',            'account_id:accounts,bridge_source_account:accounts,category_id:categories,file_import_id:file_imports,member_id:household_members,recurring_item_id:recurring_items,transfer_peer_id:transactions')
-- ),
-- actual AS (
--   SELECT c.relname::text AS tbl,
--          replace(replace(substring(pg_get_triggerdef(t.oid) FROM 'enforce_same_household_refs\((.*)\)$'), '''', ''), ' ', '') AS args,
--          (t.tgtype & 2) <> 0 AS before_,
--          (t.tgtype & 4) <> 0 AND (t.tgtype & 16) <> 0 AS ins_and_upd,
--          t.tgenabled <> 'D' AS enabled
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname = 'trg_enforce_same_household_refs'
-- ),
-- checks AS (
--   SELECT 'guard on ' || e.tbl || ': BEFORE INSERT OR UPDATE, enabled, all links' AS check_name,
--          coalesce(a.args = e.args AND a.before_ AND a.ins_and_upd AND a.enabled, false) AS ok
--     FROM expected e LEFT JOIN actual a USING (tbl)
--   UNION ALL
--   SELECT 'old transactions guard and its function are gone',
--          NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_transaction_same_household_refs')
--      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_transaction_same_household_refs')
--   UNION ALL
--   SELECT 'guard function is SECURITY DEFINER with a pinned search_path',
--          EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_same_household_refs' AND prosecdef
--                     AND proconfig @> ARRAY['search_path=public, pg_temp'])
--   UNION ALL
--   SELECT 'anon has no privilege on any public table',
--          NOT EXISTS (SELECT 1 FROM pg_class c, (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(priv)
--                       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
--                         AND has_table_privilege('anon', c.oid, p.priv))
--   UNION ALL
--   SELECT 'stripe_webhook_events: no privilege for authenticated; service_role keeps it',
--          NOT has_table_privilege('authenticated', 'public.stripe_webhook_events', 'SELECT')
--      AND NOT has_table_privilege('authenticated', 'public.stripe_webhook_events', 'INSERT')
--      AND has_table_privilege('service_role', 'public.stripe_webhook_events', 'INSERT')
-- )
-- SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks;
--
-- Then the live check (Claude Code):
--   - as Zezinho Test: a recurring item / transaction / anchor naming an id
--     that is not Zezinho's → 403 / 42501 "... does not belong to its household"
--   - as Zezinho Test, normal use still works: add + delete a manual expense,
--     create + delete a recurring item, a transfer, a card-plan save
--   - a throwaway account (T1): delete its household end to end
