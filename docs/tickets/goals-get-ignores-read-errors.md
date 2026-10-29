# GET /api/goals reads accounts without checking the error

**Filed** 2026-10-27, found while adding the Reserve Fund to its answer (for
mobile quick entry).

**Status:** FIXED in code 2026-10-29, uncommitted. All four reads (accounts,
transactions, recurring contributions, skipped dates) answer 500 with their
own reason, and the catch-all keeps the real message. The web Goals page
shows the error with Try again, never "no goals yet"; the Timeline's Add
entry form says the accounts could not be loaded. Mobile already showed the
error. Tests: 6 new in `src/app/api/goals/__tests__/route.test.ts`, 7/7
mutants caught. Found on the way:
[household-timezone-read-error-falls-back.md](household-timezone-read-error-falls-back.md).

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
