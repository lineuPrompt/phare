# The mobile diagnostics probe can never pass

**Filed** 2026-09-28, from the mobile V1 Phase 1 diagnosis
([docs/mobile-v1-phase1.md](../mobile-v1-phase1.md), out-of-scope bug 1).

**Status:** OPEN — READY. **Decided 2026-09-28 (Lineu):** send the bearer
token; keep the probe as a manual, labelled button; one review generation per
deliberate press is acceptable on a diagnostics screen. Do not retire it.

**Severity:** low. A development aid, not a product surface. No household data
is read or written.

---

## The problem

The mobile Diagnostics screen's "Non-streaming API probe" calls
`POST /api/review-stream?stream=0` through `apiPostUnauthenticated`
([apps/mobile/src/lib/api.ts](../../apps/mobile/src/lib/api.ts)) — deliberately
without a bearer token, on the premise written in that function's comment:

> That route is unauthenticated by design (it reads nothing from the database)

That premise is out of date. `/api/review-stream` now calls
`requireOnboardingGeneration(REVIEW_GENERATION_EVENT)` before generating
(auth plus the per-household monthly quota — see `src/lib/onboardingQuota.ts`).
With no session it answers 401 every time, so the probe reports failure on
every device and proves nothing about React Native's `fetch`.

## What a fix would involve

- Send the bearer token (`apiPost`), and accept that a successful probe now
  spends one of the household's ten monthly review generations; or
- retire the probe — onboarding now exercises `?stream=0` for real on every
  mobile signup.

Either way, the `apiPostUnauthenticated` comment must stop claiming the route
is unauthenticated.

## Not done here

Nothing. Filed so the next person reading the diagnostics screen does not
trust a red result as a device fault.
