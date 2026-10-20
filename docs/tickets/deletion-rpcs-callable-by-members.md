# Members can call the deletion RPCs directly

**Filed** 2026-10-20, found while checking launch plan 1.4 (who writes
`household_members`).

**Status:** OPEN. P1, belongs with launch plan 1.6 (policy review).

---

## The problem

Live, through the read-only MCP server, 2026-10-20:

| Function | Security | EXECUTE for `authenticated` | EXECUTE for `anon` |
|---|---|---|---|
| `delete_household(p_household_id, p_request_id)` | INVOKER | yes | yes |
| `delete_household_member(p_household_id, p_member_id, p_user_id, p_request_id)` | INVOKER | yes | yes |
| `household_deletion_preview(p_household_id)` | INVOKER | yes | yes |

The app calls all three through the admin client only (`/api/household`,
`/api/me`, `src/lib/deletionContext.ts`). Nothing needs a member session to
call them, yet any member can call them over PostgREST (`/rest/v1/rpc/...`).

They run with the caller's rights, so each statement still meets RLS and the
table grants. After `20261016000000` (households read-only), `20261019000000`
(users read-only) and `20261020000000` (household_members read-only,
member_deletion_requests server-only), the writes these functions make are
refused for a member. **Not yet proven:** that no statement in them still
succeeds as a member against a table the policy review has not fixed yet
(`delete_household` cascades from `households`, and other tables still carry
`FOR ALL` policies). A partial run would be a member deleting their own
household's data without a deletion request.

## The fix (proposed, not approved)

One migration:

```sql
REVOKE EXECUTE ON FUNCTION public.delete_household(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_household_member(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.household_deletion_preview(uuid) FROM PUBLIC, anon, authenticated;
```

With a VERIFY on `has_function_privilege` for each role, and a check that
`service_role` keeps EXECUTE. No code change: every caller already uses the
admin client.

Also worth checking in the same pass: `create_transfer` (INVOKER, EXECUTE for
anon) — called with the member session by design, so keep `authenticated`,
but `anon` has no reason to hold it.
