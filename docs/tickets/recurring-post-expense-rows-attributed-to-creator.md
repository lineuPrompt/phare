# POST /api/recurring attributes an expense rule's transactions to whoever created it

**Filed** 2026-10-01, found while reading the route for the first-session
extraction.

**Status:** FIXED in code 2026-10-23 (S4, approved): rows use the rule's own
member (null for an expense). Tests now check the rows, not just the rule.
Live before the fix (2026-10-23, Zezinho Test): a new bill's 12 rows all
carried the creator. Live data: household 2be22642 has 10 expense rows with a
member from one rule whose RULE also carries a member — a one-off SQL repair,
not done, needs its own approval.
CLAUDE.md §4: "Expenses never get member attribution."

## The problem

[src/app/api/recurring/route.ts](../../src/app/api/recurring/route.ts) (POST)
creates an expense rule correctly with `member_id: null`, then materializes its
transactions with `member_id: ctx.memberId` — the creator — for every row, for
expenses as well as income. save-plan already fixed the same bug in its own
materialization (it copies `item.member_id`).

Live data, read 2026-10-01: **0** expense transactions under a household-level
expense rule carry a member. So nothing to repair yet; the next expense rule
created on the Recurring page will start it.

## The fix

Materialize with the rule's own `member_id` (null for expenses), as save-plan
does. Test: an expense rule created via POST yields transactions with
`member_id` null; an income rule keeps the creator.
