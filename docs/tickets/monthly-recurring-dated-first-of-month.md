# Every monthly bill and paycheque is dated the 1st

**Filed** 2026-09-29, from the onboarding stranger audit. **STOP** (dates).

**Status:** OPEN.

[save-plan](../../src/app/api/save-plan/route.ts) (~190, used at ~473 and
~511) gives every monthly recurring item `anchor_date = <current month>-01`.
Non-monthly items correctly stay unanchored until a real date is captured;
monthly ones get a date nobody gave. A mortgage paid on the 15th and a
salary paid on the 25th both land on the 1st, so the Timeline's dips and
low points fall on the wrong days — the Timeline being the product's main
view.

## To decide

Ask the day of month for monthly lines (the anchor step already asks
semi-monthly days), or keep the 1st but mark it as assumed and prompt for it
the way unanchored items are disclosed.
