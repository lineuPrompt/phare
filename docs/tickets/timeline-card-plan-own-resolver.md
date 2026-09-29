# Timeline plan chain resolves card goals with its own function

**Filed** 2026-09-29, found during the carry-forward change.

**Status:** OPEN. Not a live wrong figure today; a second implementation of
the same rule (CLAUDE.md §4 "one source of truth").

## The problem

The Cards decision view, grid, cross-card strip and monthly review resolve
a card's plan for a month through one function, `planForMonth`
([src/lib/envelopeHelpers.ts](../../src/lib/envelopeHelpers.ts)), served by
`fetchCardPlanForMonth` ([src/lib/cardPlanServer.ts](../../src/lib/cardPlanServer.ts)).

The Timeline's 12-month plan chain still uses its own
`resolveCardBudgetsForCycle`
([src/lib/planChainHelpers.ts](../../src/lib/planChainHelpers.ts)), fed by
[src/app/api/timeline/route.ts](../../src/app/api/timeline/route.ts)'s
`monthly_goals` read. For open and future months the two agree: both are
nearest-at-or-before, by month. They differ on **closed** cycles:
`planForMonth` uses only that month's own goal, while the chain carries an
earlier goal into a closed month. The chain's first entries can reach the
previous cycle, which may be closed.

## To decide / fix

Whether a closed cycle's card cost in the chain should come from its own
goal only (Cards' rule) or from actual spend. Then route the chain through
`planForMonth` so there is one resolver. Touches Timeline money figures, so
**STOP** before fixing.
