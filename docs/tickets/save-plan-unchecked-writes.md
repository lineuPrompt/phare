# save-plan: five more writes never read their error

**Filed** 2026-09-28, found while fixing
[category-seed-insert-unchecked](category-seed-insert-unchecked.md).

**Status:** FIXED in code 2026-10-22 (launch plan 1.7). All five, plus three
more found next to them (the previous plan's recurring items: the read, the
transactions delete and the rules delete — a failure there doubled the
ledger). Each answers 500 with the reason and writes nothing after. The
letter is the exception: the plan is saved by then, so a failed letter is
logged and returned as `letterError` (200). No screen shows `letterError`
yet — see the 1.7 handoff. 10/10 mutants caught.

**Severity:** medium. Same class as the category seed: the route returns
`200 { saved: true }` over a write that did not happen (CLAUDE.md §4).

---

## The problem

In [src/app/api/save-plan/route.ts](../../src/app/api/save-plan/route.ts)
these `await supabase...` calls discard `{ error }`:

| Line | Write | If it fails silently |
|---|---|---|
| ~370 | `budgets` delete | old budgets survive next to the new ones |
| ~371 | `sinking_funds` delete | old funds survive next to the new ones |
| ~617 | `budgets` insert | the plan has no category budgets; cards show nothing budgeted |
| ~622 | `sinking_funds` insert | the plan's sinking funds are missing |
| ~639 | `conversations` insert | the household's first letter is lost |

Every other write in the route already returns a 500 carrying the database
message; these five were missed.

## The fix

Check each error and return 500 with the real reason, like the neighbouring
writes. One test per write in `src/app/api/save-plan/__tests__/route.test.ts`
(the harness from the category-seed fix — `runWithCategories` — shows the
pattern), each mutation-tested.
