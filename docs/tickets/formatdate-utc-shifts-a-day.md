# formatDate shows the day before in Canada

**Filed** 2026-11-04, found while showing a recurring rule's end date.

**Status:** FIXED in code 2026-11-04, uncommitted. No screen was wrong: every
caller passes a full timestamp (`created_at`). `formatDate` now reads a bare
date as a calendar day (through `readableDate`), so a future caller can't hit it.
Test: `src/components/dashboard/__tests__/formatDate.test.ts` (fails on the old
code: "June 29, 2027").

## The problem

`formatDate` in [src/components/dashboard/types.ts](../../src/components/dashboard/types.ts)
does `new Date(iso)` on a 'YYYY-MM-DD' string. JavaScript reads that as UTC
midnight, which is the previous evening in every Canadian zone, so
`formatDate('2027-06-30', 'en')` prints "June 29, 2027" in a browser in
Toronto.

`readableDate` (same file, moved there 2026-11-04) parses the parts as a local
date and is correct. The recurring end date uses it.

## The fix

Check each `formatDate` caller (`grep -rn "formatDate(" src`, confirmed with a
second tool) for whether it gets a bare date or a full timestamp; switch the
bare-date callers to `readableDate`. Test: '2027-06-30' renders as the 30th
under TZ=America/Vancouver.
