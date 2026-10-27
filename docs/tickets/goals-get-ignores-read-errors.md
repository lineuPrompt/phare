# GET /api/goals reads accounts without checking the error

**Filed** 2026-10-27, found while adding the Reserve Fund to its answer (for
mobile quick entry).

**Status:** OPEN. Not fixed: outside the withdrawal change.

## The problem

[src/app/api/goals/route.ts](../../src/app/api/goals/route.ts) destructures
only `data` from the accounts read (`const { data: accounts } = ...`). A
failed read becomes `accounts ?? []`, so the route answers 200 with no goals
and `reserve: null`: "you have no savings goals" in place of "Phare couldn't
read your goals". CLAUDE.md §4: silent failure is worse than visible failure.

Mobile quick entry and Goals both read this route, so a failed read there
shows "No savings goal or debt account yet" and offers to create one.

Check the transactions and recurring_items reads in the same route too.

## The fix

Read `error` on each query and answer 500 with the real reason, as
`/api/accounts` does since launch plan 1.7. Test: a scripted read error
answers 500, not an empty list.
