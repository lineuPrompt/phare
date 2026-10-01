# The manual-entry amount ceiling is ten times what the columns can hold

**Filed** 2026-10-01, found while reading production column types (read-only
MCP) during the dropped first-session work.

**Status:** OPEN.

## The problem

`MANUAL_ENTRY_MAX_AMOUNT` in [packages/core/src/entry.ts](../../packages/core/src/entry.ts)
is **999,999,999.99**, and [src/lib/expenseRequest.ts](../../src/lib/expenseRequest.ts)
(~line 130) accepts any amount up to it.

The columns it lands in are `numeric(10,2)` in production:
`transactions.amount` and `recurring_items.amount` — largest value
**99,999,999.99**. (`accounts.balance` and `account_balance_anchors.balance`
are `numeric(12,2)`.)

So an amount from 100,000,000 to 999,999,999.99 passes validation and then
fails at insert with a numeric-overflow error — a 500 instead of the route's
own clear refusal. The comment on the constant says "the input is refused,
never clipped", which the database honours, but with the wrong error.

Not a realistic household amount, so low severity; it is a validator that
promises more than the storage can keep.

## The fix

Set the ceiling to the column's limit (99,999,999.99), or widen the columns
(a migration). Test: 99,999,999.99 accepted end to end; 100,000,000.00
refused by the validator with its own message, not by the database.
