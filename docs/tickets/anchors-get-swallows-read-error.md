# GET /api/anchors swallows a failed read and answers "no anchors"

**Found:** 2026-10-15, building mobile month navigation (standalone S2).
**Status:** FIXED in code 2026-10-22 (launch plan 1.7). GET answers 500 with the
reason on a failed anchors read, and on a failed account read (was a 404;
now `.maybeSingle()`, so "no row" stays a 404). The web Timeline no longer
sends any non-401 failure to the sign-in page: it shows "Could not load your
timeline" with the reason and a retry (EN/FR). Mobile already threw on it.
Tests: `src/app/api/anchors/__tests__/route.test.ts`, 4/4 mutants caught.

## What happens

`src/app/api/anchors/route.ts`, GET:

```ts
const { data: anchors } = await supabase
  .from('account_balance_anchors')
  ...
return NextResponse.json({ anchors: anchors ?? [] });
```

`error` is never read. If the query fails, the route answers 200 with
`{ anchors: [] }`, which is the same answer as "this account has never been
anchored".

## Why it matters

Both Timelines (web `timeline/page.tsx` and, since S2, mobile
`timelineLoader.ts`) use the earliest anchor to pull the window back for
month navigation. A failed read makes every past month disappear with no
error. It looks exactly like a household with no history. That breaks the
"silent failure is worse than visible failure" rule (CLAUDE.md §4).

## Fix (when picked up)

Read `error` and answer 500 with the real reason, as the other anchor reads
do. Add a route test that a failed read is a 500 and not `{ anchors: [] }`,
and mutation-test it.
