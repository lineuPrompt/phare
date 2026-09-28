# POST /api/expenses trusted its body

**Filed** 2026-09-28, from the mobile V1 Phase 1 diagnosis
([docs/mobile-v1-phase1.md](../mobile-v1-phase1.md), out-of-scope bug 4).
**Fixed** 2026-09-28 in 37740fa, approved as a separate web commit.

**Status:** CLOSED.

---

## What was wrong

- A negative amount was accepted and saved.
- No date validation: `'2026-02-31'` reached Postgres and came back as a 500.
- No description length bound — unbounded input into a text column.
- No installments bound: `installments: 100000` tried to insert 100,000 rows.
- `accountId` and `categoryId` were not checked against the caller's
  household (see [transactions-cross-household-references.md](transactions-cross-household-references.md)).
- Errors carried English prose only, no `code`.

## What changed

[src/lib/expenseRequest.ts](../../src/lib/expenseRequest.ts) validates the body
before any database call: 16 KB byte cap; amount a number above 0, at most
999,999,999.99, at most two decimals; a real calendar date; description
required and at most 200 characters, refused, never cut; installments a whole
number from 2 to 48; ids in UUID shape. The route then looks up the account
and category scoped to the caller's household. Every refusal is
`{ code, error }`.

Limits live in `@phare/core` (`MANUAL_ENTRY_*`) so the mobile quick-entry
screen can say so before it sends.

## Behaviour changes a web user could notice

- Installments of 1 used to save silently as one row; now refused with
  `INVALID_INSTALLMENTS`. The web input's own minimum is 2.
- An amount with a third decimal is refused rather than stored.
- An unrecognised `repeat` value still means "once", unchanged.
