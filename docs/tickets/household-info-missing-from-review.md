# Household answers never reach the monthly review

**Filed** 2026-09-28, from the backlog reconciliation.

**Status:** OPEN. Product decision — diagnose and propose, stop.

---

## The problem

The Household sheet's answers (province, employer's province, and the rest)
reach exactly one prompt: `/api/plan`, through `parsed.household`
([src/lib/promptInputLimits.ts](../../src/lib/promptInputLimits.ts),
`assertHouseholdShape`). Neither review path reads them —
[src/lib/monthlyReviewService.ts](../../src/lib/monthlyReviewService.ts) nor
[src/app/api/review-stream/route.ts](../../src/app/api/review-stream/route.ts).
They are not stored anywhere a later month could read them.

So a tax gap that depends on them — a Quebec household with an
out-of-province employer, whose source deductions do not match what Quebec
will assess — can be named once, in the onboarding plan, and never again.

## What the proposal needs to cover

- Whether household answers should be stored at all (they are free text a
  household typed into Excel), and where.
- Which answers a monthly review may use, and how the AI is kept to
  narrating a code-computed flag rather than inferring tax positions itself
  (CLAUDE.md §4: code owns all math).
