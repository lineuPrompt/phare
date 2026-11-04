# A plain edit of a split rule rewrites dates before its start

**Filed** 2026-11-04, found while adding the recurring end date.

**Status:** OPEN. Dates / materialization: diagnose and STOP for approval.

## The problem

PATCH /api/recurring/[id]'s METADATA path (a description, category, account,
member or end-date edit) deletes the rule's rows from the 1st of the current
month and re-materializes 12 months from there. It never reads the rule's
`effective_from`.

A rule created by a split (a raise effective 1 December) and then renamed in
November gets November rows of its own, while its predecessor still holds
November's: the month shows the bill twice. The split path filters
`d >= effectiveFrom`; the metadata path does not.

## The fix (to diagnose first)

Read `effective_from` with the rule, and on the metadata path delete and
re-materialize from `max(month start, effective_from)` only. Test: a split
successor effective next month, renamed this month, gains no row this month.

## Diagnosis (2026-11-04)

- Confirmed in `src/app/api/recurring/[id]/route.ts`: the metadata path
  deletes from `monthStartStr` and calls `materializeFromMonthStart` with no
  `effective_from` floor (around lines 226–255). The split path filters
  `d >= effectiveFrom`.
- Two cases double a bill: a successor effective later this month or next
  month, then edited this month.
- Live: **0 rows** anywhere dated before their rule's `effective_from`
  (read 2026-11-04). Nobody is affected yet.
- Fix: floor = the later of month start and `effective_from`, for both the
  delete and the re-materialization. One line each, plus the test above.
- Same block, also found: the tombstone read (`recurring_skipped_dates`)
  ignores its error. A failed read would resurrect deleted occurrences.
  Fix with it: fail with 500 on that error.

Waiting for approval (dates).
