# getHouseholdTimezone turns a failed read into Toronto time

**Filed** 2026-10-29, found while fixing GET /api/goals' silent read errors
([goals-get-ignores-read-errors.md](goals-get-ignores-read-errors.md)).

**Status:** FIXED in code 2026-11-02, uncommitted (Lineu: finish the pending
tasks). The helper throws on a failed read. Every caller checked: each
answers 500 with the reason from its own catch; the quota helpers fail
closed; account create keeps its "account created, balance not saved"
answer. Tests: 3 + 1, 2/2 mutants caught.

## The problem

[src/lib/householdTimezone.ts](../../src/lib/householdTimezone.ts) reads
`households.timezone` and ignores the read's `error`. A failed read returns
`DEFAULT_HOUSEHOLD_TIMEZONE` (America/Toronto) as if the household had chosen
it. For a household in Vancouver, Edmonton or Halifax, `businessToday` can
then be a different day from the household's own. The route answers 200, so
balances can include or leave out that day's rows, and nothing says why.

The comment says the fallback is for a missing value, which the NOT NULL
column rules out. A failed read is a different case, and it is not handled.

## The fix (to diagnose first)

Throw on `error` so each route's own error path reports it. Before changing
it, check each of the 23 callers (`grep -rl getHouseholdTimezone src`) to
confirm that a throw there becomes a visible 500 rather than a swallowed
catch. Test: a scripted read error makes the helper throw, and one caller
answers 500.
