# Any signed-in user can write, change or delete their household's events

**Filed** 2026-10-10, found while making `review_guard_failed` server-only.

**Status:** OPEN. Schema / RLS change: diagnose and stop for approval.

---

## The problem

`events` has one policy (read via MCP, 2026-10-10):

```
events_all  FOR ALL  TO public
USING (household_id = (SELECT users.household_id FROM users WHERE users.id = auth.uid()))
WITH CHECK  (none)
```

`FOR ALL` covers INSERT, UPDATE and DELETE. Any signed-in member can therefore
call PostgREST directly with their own session and:

- insert any `event_type` for their household — `review_guard_failed`,
  `viewed_monthly_review`, funnel events — bypassing `/api/events` and
  `CLIENT_EVENT_ALLOWLIST` entirely;
- **delete** rows the quota and spend counters count (CLAUDE.md §8: "the
  quota/spend counters count rows in it"), resetting their own regeneration
  or onboarding-generation allowance.

`CLIENT_EVENT_ALLOWLIST` only governs what `/api/events` accepts. It is not
the only door.

## What "server only" means today

`review_guard_failed` is written by the server and is not in the allowlist
(pinned by `clientEvents.test.ts`), so `/api/events` refuses it. That is all
the code can promise until the policy changes.

## What the proposal needs to cover

- A policy split: SELECT for members; INSERT/UPDATE/DELETE only for the
  service role (or a narrow INSERT limited to the client allowlist, if any
  client writes go straight to the table today — check first).
- Which existing writes run on a user's session rather than the admin client
  (logEvent is called with session clients in several routes) — they would
  break under a service-role-only policy.
- A VERIFY block proving a session client can no longer insert or delete.
