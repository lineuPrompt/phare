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
