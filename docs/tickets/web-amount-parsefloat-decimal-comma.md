# Web entry forms read amounts with parseFloat

**Filed** 2026-10-22, found while checking what clients send to
`PATCH /api/expenses/[id]` (launch plan 1.7).

**Status:** OPEN. P1 — money input; a wrong figure is saved with no error.

---

## The problem

The web edit forms build the amount with `parseFloat`:

- `src/components/timeline/DayLedger.tsx` (PATCH `/api/expenses/[id]`):
  `amount: parseFloat(amount)`
- `src/components/cards/CardDecisionView.tsx` (same route):
  `amount: parseFloat(amount)`

`parseFloat('12,50')` is `12`: it stops at the comma and returns what it has,
silently. A French-speaking household typing a decimal comma records $12 for
a $12.50 purchase, and nothing on screen says so. Mobile already avoids this
with `parseAmountInput` from `@phare/core`, which reads both `.` and `,` and
refuses anything it cannot read exactly.

Other web forms likely do the same (create forms, transfer edit, goal forms);
a grep for `parseFloat(` and `Number(` on amount fields across
`src/components` and `src/app/[locale]` is the first step.

## The fix (proposed)

Every web amount field goes through `parseAmountInput` (core — one source of
truth), and a null result is shown as a field error before anything is sent.
One test per form path where a render harness allows it; otherwise unit tests
on the shared reader plus a manual check, stated as such.
