# DELETE /api/me never revokes a mobile caller's sessions

**Filed** 2026-09-28, from the mobile V1 Phase 1 diagnosis
([docs/mobile-v1-phase1.md](../mobile-v1-phase1.md), out-of-scope bug 2).

**Status:** FIX IN PROGRESS — approved to fix before the mobile deletion
screen ships, as its own web commit.

**Severity:** medium, on one path. Only the 202 "partial" outcome is exposed.

---

## The problem

Step 3 of `DELETE /api/me` ([src/app/api/me/route.ts](../../src/app/api/me/route.ts))
revokes every refresh token for the departing user:

```ts
const { data: { session } } = await supabase.auth.getSession();
if (session?.access_token) {
  await admin.auth.admin.signOut(session.access_token, 'global');
} else {
  console.error('Self-deletion — no access token available for global sign-out ...');
}
```

`supabase` is `createClient()` from
[src/lib/supabase-server.ts](../../src/lib/supabase-server.ts). For a browser
caller that is the cookie client, which has a session. For a **bearer**
caller — the mobile app — it is a supabase-js client built with
`persistSession: false` and the token only in `global.headers`. It has no
stored session, so `getSession()` returns `null`, the `else` branch runs, and
the global sign-out never happens.

## When it matters

- **200 (deleted):** harmless. `auth.admin.deleteUser` removes the auth user,
  and its sessions and refresh tokens go with it.
- **202 (partial):** `deleteUser` failed and the route says "Final removal of
  your login is still in progress." Access is already dead through the
  database (no `household_id`, so every route 401s and RLS matches nothing).
  But the refresh token is alive: a device can keep minting access tokens for
  an identity that was meant to be erased, until the retry completes.

## The fix

Read the caller's access token from the request itself when it arrived as a
bearer header, and from the cookie session otherwise — one helper in
`supabase-server.ts`, used by the route. Verified live by querying
`auth.sessions` / `auth.refresh_tokens` for the user after a throwaway-account
deletion (see the Phase 2 device checklist).
