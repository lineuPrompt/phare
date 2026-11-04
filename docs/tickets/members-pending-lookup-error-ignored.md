# Members list: a failed "pending" lookup shows the person as Pending

**Filed** 2026-11-04, found while building the app's Household screen.

**Status:** OPEN. Auth-adjacent: diagnose and STOP for approval.

## The problem

GET /api/household/members (`src/app/api/household/members/route.ts`, owner
branch) calls `admin.auth.admin.getUserById` per member and ignores its
`error`. A failed lookup gives `last_sign_in_at` undefined, and
`isPendingMember` turns that into `true`: an active member is shown as
"Pending" on the web page and in the app, and the web hides "Make owner" for
them. The failure itself is never said.

## The fix (to diagnose first)

Return the lookup's failure: either a 500 for the list, or `pending: null`
rendered as "status unavailable" (web and app). Test: a getUserById error
never yields a confident `pending` value.
