# Product question: does a recurring item's date mean "starts on" or "repeats on"?

**Filed** 2026-10-22, found during the live check of launch plan 1.6
(cross-household references), on Zezinho Test.

**Status:** OPEN — a product question for Lineu, NOT a bug. P3. No change
until Lineu decides.

---

## What the app does today (by design)

`POST /api/recurring` materializes from the start of the CURRENT month
(`materializeFromMonthStart`, `packages/core/src/dateHelpers.ts`), treating
`anchorDate` as "a day this repeats on", not "the first day it exists". The
route comment gives the reason: a pay or bill set up mid-month already
happened earlier that month, and months are real, not just their remainder.

Live data, 2026-10-22 (read-only scan): 9 rules hold rows dated before their
anchor — all biweekly, all backfilled within the anchor's own month (e.g. a
paycheck anchored July 15 also has July 1). That is the intended behaviour,
and Lineu reports everything looks right in use.

## The one case it does not cover

A rule whose anchor is in a LATER month. On 2026-10-22 a monthly expense
anchored 2026-11-20 also produced a 2026-10-20 row: past-dated, so it counted
in that day's balance at once. Only a deliberate test input did this; no real
household has such a row.

## The question

When someone sets up a recurring item that genuinely starts later (new rent
from next month), should the current month get an occurrence? If not, the
fix would be to start materializing at `max(current month start, anchor's
month start)` — keeping the same-month backfill. Money and dates: diagnose
and stop for approval before any change.
