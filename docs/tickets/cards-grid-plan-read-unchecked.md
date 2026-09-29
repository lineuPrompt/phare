# Cards grid: plan reads never check their error

**Filed** 2026-09-29, found while building the one-read-rule change
(carry-forward ticket).

**Status:** OPEN.

**Severity:** medium. A failed read renders as "no plan" — every column's
goal blank and every category budget $0 — with a 200 and no sign of why
(CLAUDE.md §4).

## The problem

[src/app/api/card-envelope/grid/route.ts](../../src/app/api/card-envelope/grid/route.ts)
reads `card_envelope_items` (~line 86), `monthly_goals` (~101) and
`categories` (~113) with `const { data } = ...` and never reads `error`.
The transactions read in the same route already throws on error (the
"$0 trap" fix); these three were missed.

The decision view, cross-card strip and review now read the same plan through
`fetchCardPlanForMonth`, which throws. So on a failed read the grid shows "no
plan" on the same screen where the decision view shows a 500.

## The fix

Throw on each error, as the transactions read does. One test per read using
`makeFakeCardSupabase`'s `failTables`, mutation-tested.
