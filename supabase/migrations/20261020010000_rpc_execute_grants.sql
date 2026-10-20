-- =============================================================================
-- Phare — who may call the public functions. 2026-10-20.
--
-- STATUS: WRITTEN — not applied.
--
-- NO CODE CHANGE, NO ORDERING. Every caller already uses the right client:
--   admin (service role) only:  delete_household, delete_household_member,
--                               household_deletion_preview
--   member session:             create_transfer, delete_goal_account,
--                               delete_sinking_fund_buffer
-- Safe to apply at any time.
--
-- Launch plan item 1.6, first fix (docs/tickets/deletion-rpcs-callable-by-members.md).
-- Approved by Lineu 2026-10-20.
--
-- FOUND. Live, through the read-only MCP server, 2026-10-20 — every one of the
-- six is SECURITY INVOKER and carries EXECUTE for PUBLIC (Postgres' default),
-- plus explicit grants:
--   delete_household, delete_household_member, household_deletion_preview,
--   delete_goal_account, delete_sinking_fund_buffer
--       {=X, postgres, anon, authenticated, service_role}
--   create_transfer
--       {=X, postgres, authenticated, service_role}
-- So any member — or anyone with only the publishable key — could call the
-- deletion functions over /rest/v1/rpc.
--
-- WHY NOTHING HAPPENED. Each call is one transaction and the functions run
-- with the caller's rights: delete_household stops at its own "accounts still
-- exist" guard and members cannot delete households (20261016000000);
-- delete_household_member's member-row update is refused (20261020000000) and
-- before that its users update was (20261019000000), undoing the whole call.
-- Safe today only because of those table fixes; this removes the dependence.
--
-- AFTER THIS:
--   the three deletion functions: service_role only (and the owner, postgres).
--   the three member functions: authenticated + service_role. No PUBLIC, no anon.
-- Trigger functions are untouched: Postgres refuses to call them directly.
-- =============================================================================

BEGIN;

-- ---- server only ------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.delete_household(uuid, uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_household_member(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.household_deletion_preview(uuid)                FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_household(uuid, uuid)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_household_member(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.household_deletion_preview(uuid)                TO service_role;

-- ---- members, signed in only ------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_goal_account(uuid, uuid, date)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_sinking_fund_buffer(uuid, uuid, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_goal_account(uuid, uuid, date)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_sinking_fund_buffer(uuid, uuid, date) TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- VERIFY — run after applying, as its own run. Read-only.
-- Expected: every `result` = PASS (6 rows).
-- =============================================================================
--
-- WITH f(name, sig, members_may_call) AS (
--   VALUES
--     ('delete_household',           'public.delete_household(uuid, uuid)'::regprocedure,                    false),
--     ('delete_household_member',    'public.delete_household_member(uuid, uuid, uuid, uuid)'::regprocedure, false),
--     ('household_deletion_preview', 'public.household_deletion_preview(uuid)'::regprocedure,                false),
--     ('create_transfer',            'public.create_transfer(uuid, uuid, uuid, uuid, numeric, date, text, uuid, text)'::regprocedure, true),
--     ('delete_goal_account',        'public.delete_goal_account(uuid, uuid, date)'::regprocedure,           true),
--     ('delete_sinking_fund_buffer', 'public.delete_sinking_fund_buffer(uuid, uuid, date)'::regprocedure,    true)
-- )
-- SELECT name,
--        CASE WHEN NOT has_function_privilege('anon', sig, 'EXECUTE')
--              AND has_function_privilege('authenticated', sig, 'EXECUTE') = members_may_call
--              AND has_function_privilege('service_role', sig, 'EXECUTE')
--              AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
--                               WHERE p.oid = sig AND a.grantee = 0)   -- no PUBLIC grant
--             THEN 'PASS' ELSE 'FAIL' END AS result
--   FROM f;
--
-- Then the live check (Claude Code, Zezinho Test, publishable key):
--   - POST /rest/v1/rpc/delete_household as Zezinho → 403 / 42501 (permission
--     denied for function), arguments pointing at nonexistent ids
--   - the same call with no session (publishable key only) → refused
--   - create_transfer still callable as Zezinho: called with a nonexistent
--     household id it must fail on the function's own logic, NOT on 42501
