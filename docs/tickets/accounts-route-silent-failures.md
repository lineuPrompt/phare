# /api/accounts: two silent failures

**Found:** 2026-10-16, building mobile accounts (standalone S3).
**Status:** FIXED in code 2026-10-22 (launch plan 1.7). GET: a failed read is a
500 with its reason. POST: a failed opening balance answers 500
`code: 'opening_balance_failed'` with the reason AND the created account;
the web goal form treats that as created (no second account), and the goal
list shows an EN/FR notice with the reason. POST also refuses before writing
when the existing-order read fails. Tests:
`src/app/api/accounts/__tests__/route.test.ts` (new), 8/8 mutants caught.
Mobile's workaround (create bare, then PATCH the balance) still works and can
stay.

## 1. POST drops a failed opening balance and answers 200

`src/app/api/accounts/route.ts`, POST: when `openingBalance` is sent and
`setOpeningBalance` fails, the route logs "Non-fatal: account created, just
the opening balance didn't seed" and returns `{ account }` with 200. The
caller is told it worked. The savings account exists, but its starting
balance is missing, so every goal figure is low by that amount and nothing
says so.

PATCH `/api/accounts/[id]` already treats the same failure as fatal (500).

**Mobile workaround (S3):** the app never sends `openingBalance` on create.
It creates the account bare, then PATCHes the balance and reports a failed
PATCH ("added, but its starting balance wasn't saved", with a retry).

**Fix:** make POST answer an error naming what happened when the balance
fails (the account exists, the balance didn't save), or create both in one
transaction. Check whether the web form relies on the current 200.

## 2. GET ignores a failed read and answers an empty list

`GET /api/accounts` reads `{ data: accounts }` and never looks at `error`,
so a failed read answers `{ accounts: [] }`. On mobile that shows as:
- "No accounts yet";
- Chequing offered as an account type to add, which risks a second chequing account;
- "no chequing" on the Timeline.

On the web it shows the same way.

**Fix:** read `error`, answer 500. Add a route test, mutation-tested.
