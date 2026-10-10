# The mobile household gate logs a review view it never showed

**Filed** 2026-10-09, found while diagnosing the mobile Home tab.

**Status:** CLOSED 2026-10-09. The gate asks for `/api/dashboard?snapshotOnly=1`.
Verified live on Zezinho Test: `viewed_monthly_review` count 40 before a
launch (gate, then Home) and 40 after; a full dashboard load then took it to 41.

---

## The problem

`apps/mobile/src/lib/householdGate.ts` reads `hasPlan` from a full
`GET /api/dashboard`. On a full (non-`snapshotOnly`) load, that route logs
`viewed_monthly_review` whenever the household has a review
([src/app/api/dashboard/route.ts](../../src/app/api/dashboard/route.ts),
"Review-open instrumentation").

So every time the mobile gate runs for a household with a review, the
event is written although no review was on screen. The event is described
in the route as "the strongest available retention predictor"; mobile
sessions inflate it.

Read from the code only. The size of the inflation in `events` has not
been measured.

## Options

- The gate calls `/api/dashboard?snapshotOnly=1`, which returns `hasPlan`
  and returns before the event is logged. It still runs the month totals
  the gate does not need.
- A dedicated plan-existence read for the gate.

## Related

The mobile Home tab (BACKLOG item 6) should call `snapshotOnly=1` for the
same reason.
