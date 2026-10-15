# GET /api/anchors swallows a failed read and answers "no anchors"

**Found:** 2026-10-15, building mobile month navigation (standalone S2).
**Status:** filed, not fixed (out of scope).

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
