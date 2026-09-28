# Cards: the month-by-month table needs its own month navigation

**Filed** 2026-09-28, from the backlog reconciliation.

**Status:** OPEN. UI only.

---

## The problem

On the Cards page ([src/app/[locale]/cards/page.tsx](../../src/app/%5Blocale%5D/cards/page.tsx)),
the decision view, the envelope, the cross-card overview and the 12-month
grid all follow one page-level month, `effectiveMonth` (the grid request is
`/api/card-envelope/grid?...&month=${effectiveMonth}`, around line 143).
Moving the table's window therefore moves the whole page, and looking at the
table's other months means leaving the month being planned.

## What to build

A month control on the table (`CardGrid.tsx`) that moves only the grid's
window, independent of the page selector. Reuse the page's existing month
control component rather than a second one.
