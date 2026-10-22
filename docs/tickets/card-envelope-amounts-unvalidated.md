# Card plan amounts are not validated

**Filed** 2026-10-22, found while moving the card plan's writes to the
service role (launch plan 1.6, closed cycles).

**Status:** OPEN. P2.

---

## The problem

`POST /api/card-envelope` checks `totalGoal` (a number, not negative) but not
the per-category amounts. Each `items[].monthlyAmount` is written to
`card_envelope_items.monthly_amount` (`numeric(10,2)`) as sent:

- a negative amount is saved, and shows as a negative category budget;
- a string, `null` or `NaN` reaches the insert; Postgres refuses most of these
  and the route answers a generic 500 "Failed to save categories", hiding the
  real reason;
- an amount above 99,999,999.99 overflows the column — same generic 500,
  where CLAUDE.md asks for "reject oversized input" with a clear 400.

The sum of the items is also not compared with `totalGoal`; whether it should
be is a product question, not a validation bug.

## The fix (proposed)

Before any read or write: each `monthlyAmount` must be a finite number,
`>= 0`, at most two decimals and `<= 99,999,999.99`; otherwise 400 naming the
item. One test per rule, each failing against today's code.
