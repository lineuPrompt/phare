# Any signed-in member can give their own household Pro

**Found:** 2026-10-16, while designing in-app purchase. **Severity: high**
(billing). **Status:** FIXED. Applied 2026-10-16:
`supabase/migrations/20261016000000_households_read_only_for_clients.sql`.
Verified live: privileges and policy checks, 7/7 PASS, and over PostgREST
as Zezinho Test: read 200, PATCH refused 403/42501, row unchanged.
Not exploited by me.

## What is wrong

Live database, checked through the read-only MCP:

- Policy on `households`: `"Users see own household"`, **cmd = ALL**
  (`*`), `USING (id IN (SELECT household_id FROM users WHERE id = auth.uid()))`.
  It is not limited to SELECT.
- `has_column_privilege('authenticated', 'public.households', <col>, 'UPDATE')`
  is **true** for `comp_until`, `subscription_status`,
  `subscription_current_period_end`, `subscription_cancel_at_period_end`,
  `stripe_customer_id`, `stripe_subscription_id` and `name`.

So any signed-in member, with the public (publishable) key and their own
session, can call the Supabase REST API directly and run
`UPDATE households SET comp_until = '2099-12-31' WHERE id = <their household>`.
`entitlementFor` would then answer Pro (reason `comp`) on every route, web
and mobile. They can also rewrite their Stripe fields.

The repo migration (`20260618000000_initial_schema.sql`) defines separate
`households_select` / `households_update` policies. The live policy name
differs, so the live database was changed outside the repo's migrations at
some point.

## Who legitimately writes `households`

From a code search (Grep + a second check with grep in Bash), only:
- the Stripe webhook (`createAdminClient`, service role: unaffected by grants
  and RLS);
- `handle_new_user` (SECURITY DEFINER);
- admin reads in checkout, portal and household deletion.

No route or client updates `households` through the user's own session.

## Proposed fix (migration, Lineu applies)

1. Revoke `INSERT, UPDATE, DELETE` on `public.households` from
   `authenticated` and `anon`. Keep SELECT.
2. Replace the ALL policy with a SELECT-only policy (same USING clause).
3. VERIFY block:
   - `has_column_privilege` is false for every billing column, for both
     roles;
   - the policy is SELECT-only;
   - a live check (Zezinho Test session) shows the REST update is refused
     and no row changed.

## Before applying, check (read-only)

- No household has a `comp_until` or Stripe value that no admin path wrote:
  list every non-null `comp_until` and compare it with the known comps (the
  demo household, Zezinho Test).
- The same check for other tables with an ALL policy whose rows feed
  entitlement or quotas (`events` is already ticketed as client-writable).
