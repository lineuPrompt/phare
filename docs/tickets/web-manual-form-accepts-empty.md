# Web manual form builds a plan from nothing, and drops half-filled lines silently

**Filed** 2026-09-29, from the onboarding stranger audit.

**Status:** OPEN.

The web manual lane ([ManualForm.tsx](../../src/components/onboarding/ManualForm.tsx),
`submitForm` in [upload/page.tsx](../../src/app/%5Blocale%5D/upload/page.tsx))
has no required field: an empty form goes through plausibility (net 0 passes),
the accounts step, and spends a plan and a review generation on an empty
plan. A line with an amount but no label is dropped without a word
(`buildCalculatedFromFormLines`, `.filter((l) => l.label.trim() && l.amount)`).

Mobile already refuses both (`buildForm` in
[apps/mobile/src/lib/onboardingFlow.ts](../../apps/mobile/src/lib/onboardingFlow.ts):
`noIncome`, `labelMissing`, `amountInvalid`). Move that validation into
@phare/core and use it on both.
