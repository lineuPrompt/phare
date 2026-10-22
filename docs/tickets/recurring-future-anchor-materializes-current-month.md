# A recurring rule that starts next month still creates this month's row

**Filed** 2026-10-22, found during the live check of launch plan 1.6
(cross-household references), on Zezinho Test.

**Status:** OPEN. P1 — money and dates (diagnose first, stop for approval).

---

## What happened

On 2026-10-22, `POST /api/recurring` with a monthly expense and
`anchorDate: '2026-11-20'` answered `materialized: 12` and wrote a
transaction dated **2026-10-20** — a month before the rule's own start, and
in the past, so it counted in the household's balance at once ("balances sum
transactions dated <= today").

Deleting the rule (`DELETE /api/recurring/[id]`) removed rows dated today
onward and kept the 2026-10-20 row as history, detached
(`recurring_item_id` NULL). The probe row was removed by hand afterwards.

## Why

`src/app/api/recurring/route.ts` materializes with
`materializeFromMonthStart(rule, today, 12)` (`packages/core/src/dateHelpers.ts`),
which runs `materializeRule(rule, <current month>, 12)`. For a monthly rule
only the anchor's DAY is used, so every month from the current one gets an
occurrence — including months before `anchorDate`.

The route comment explains the month-start choice (a bill already paid on
the 1st, added mid-month, still needs that month's row). That reasoning holds
for an anchor in or before the current month, not for one in a later month.

## Questions before a fix

- Should materialization start at `max(month start, anchorDate)`? Likely yes,
  but biweekly/weekly rules count from the anchor itself; check them too.
- Does PATCH's re-materialization (`splitRule`) have the same behaviour?
- Do existing households hold rows dated before their rule's anchor? A
  read-only scan: transactions joined to recurring_items where
  `date < anchor_date`.
- Separately (existing ticket `recurring-post-expense-rows-attributed-to-creator.md`):
  the row carried the creator's `member_id`.
