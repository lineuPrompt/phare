# POST /api/transfers does not check its date or its amount ceiling

**Filed** 2026-10-27, found while adding withdrawals (a draw from savings or
the Reserve Fund) to the same route.

**Status:** OPEN. Not fixed: outside the withdrawal change.

## The problem

[src/app/api/transfers/route.ts](../../src/app/api/transfers/route.ts) (POST)
checks only that `date`, `amount` and `goalAccountId` are present and that the
amount is positive. Its own PATCH sibling,
[src/app/api/transfers/[id]/route.ts](../../src/app/api/transfers/[id]/route.ts),
already refuses (since launch plan 1.7):

- a date that is not a real calendar date (`isCalendarDate`, `INVALID_DATE`);
- an amount above `MANUAL_ENTRY_MAX_AMOUNT` (`INVALID_AMOUNT`);
- a description over `MANUAL_ENTRY_DESCRIPTION_MAX_CHARS`
  (`DESCRIPTION_TOO_LONG`). CLAUDE.md §4: reject oversized input, never
  truncate it.

On POST, `2026-02-30` reaches `create_transfer` and Postgres refuses it with a
raw error (500, not a 400 the app can explain). An oversized description is
written as sent.

The withdrawal balance check added on 2026-10-27 compares dates as strings, so
it relies on the date being a real `YYYY-MM-DD`; Postgres still refuses a bad
one afterwards, so nothing wrong is written.

## The fix

Give POST the same three checks as PATCH, with the same codes, before any
database call. Tests: each refused with its code and no RPC call.
