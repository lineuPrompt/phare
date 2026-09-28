# The dashboard has its own formatResetDate, and it disagrees with core's

**Filed** 2026-09-28, found while moving `formatResetDate` into `@phare/core`
(mobile V1 Phase 2, step 0).

**Status:** OPEN. Filed only — changing it changes the dashboard's output.

**Severity:** low. Display of a quota reset date.

---

## The problem

Two functions named `formatResetDate` format the same kind of value:

| | `@phare/core` (`packages/core/src/onboarding.ts`) | `src/app/[locale]/dashboard/page.tsx:41` (local) |
|---|---|---|
| Parsing | noon UTC, formatted with `timeZone: 'UTC'` | local midnight via `new Date(y, m - 1, d)` |
| Malformed input | `''` | the raw string, echoed |
| Used for | onboarding quota message (web + mobile) | regeneration quota message on the dashboard |

The local-midnight version is correct in every Canadian zone today, because
`toLocaleDateString` also renders in local time. But it is a second copy of a
rule `CLAUDE.md` says must have one home, and on malformed input it prints
`2026-9-1`-style text where core prints nothing.

## The fix

Delete the local function and import core's. Then decide what the
dashboard's quota message should say when `resetsOn` is malformed: core
returns `''`, so the sentence would render with its date slot empty.
