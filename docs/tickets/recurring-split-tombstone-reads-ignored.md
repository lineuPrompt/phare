# A split can bring back deleted entries when a skipped-dates read fails

**Filed** 2026-11-05, found while fixing the double bill.

**Status:** OPEN. Dates / materialization: diagnose and STOP for approval.

## The problem

`splitRule` in `src/app/api/recurring/[id]/route.ts` (an amount or schedule
change "from a date"):

- reads the old rule's skipped dates (`carryRows`) and ignores the read's
  error: a failed read carries nothing forward;
- logs the carry-forward insert's failure as "non-fatal" and goes on;
- reads the new rule's skipped dates for materialization and ignores that
  error too.

In each case the new rule is then written over dates the household had
deleted or edited alone: those entries come back, and an edited-alone one
shows twice (the edited row plus the regenerated one).

The plain-edit path got the same guard on 2026-11-05 (a failed read stops
before anything is deleted).

## The fix (to diagnose first)

Do the reads before the old rule is frozen and its rows are deleted, and
stop with a 500 on any failure, so a failed read changes nothing. Tests: each
failure leaves the old rule active and every row in place.
