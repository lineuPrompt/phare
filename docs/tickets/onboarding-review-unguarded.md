# The onboarding review is generated with none of the review guards

**Filed** 2026-09-28, from the backlog reconciliation.

**Status:** OPEN. Diagnose and stop for approval (AI output).

**Severity:** high relative to its reach. It is the first letter every
household reads, and it is persisted.

---

## The problem

The monthly review path, [src/lib/monthlyReviewService.ts](../../src/lib/monthlyReviewService.ts),
checks generated text after the model answers and retries once on a
violation (`checkReviewGuards`, around line 885): an unsourced spending
category, borrowed cash framed as income (`enforceBorrowedCashFraming`), and
a leaked placeholder token (`containsUnsubstitutedToken`). It also pins the
top recommendation's debt figure (`enforceDebtFigureInTopRecommendation`).

The onboarding review, [src/app/api/review-stream/route.ts](../../src/app/api/review-stream/route.ts),
runs the same kind of prompt with none of those checks. Its own comment
(around line 161) says so: "the guarded path is monthlyReviewService". The
streamed text goes straight to the client, and `POST /api/save-plan` stores
it as the household's first letter (`conversations`). The mobile app's
`?stream=0` path does the same.

## What the diagnosis needs to answer

- Which guards apply to an onboarding plan (no ledger yet: "sourcing" may mean
  something different before any transaction exists).
- Whether streaming can be kept at all if the text must be checked before it
  is shown — or whether the check runs before save and a violation replaces
  the stored text.
- Whether one shared guard module should serve both paths, so they cannot
  drift again.

## Finding, 2026-10-10 (monthly review fix, BACKLOG item 6)

The figure guard built for the monthly review (`src/lib/letterGuards.ts`:
every dollar figure must equal, to the cent, a number in the payload) was
**not** switched on for the onboarding letter.

- **It cannot be checked against stored letters.** The onboarding payload is
  the plan the client sends to `/api/review-stream`; it is never stored. The
  11 stored onboarding letters (1 for 2be22642, 10 for Zezinho Test) have
  nothing to be compared against.
- **They would often fail.** At least 4 of the 11 write rounded figures
  ("$5,417" for 5,416.67, « 1 733 $ », "$179", "$1,733"), which the guard
  rejects by design.
- **The letter is streamed** to the screen before it could be checked, and
  `save-plan` stores the text the client sends back. A guard there could only
  refuse to store it, after the household has read it.

Decision needed before wiring: where the check runs (save-plan, or a
non-streamed generation), what a household sees when its first letter is
refused, and whether the prompt first moves to exact figures.
