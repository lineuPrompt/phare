# An older future-month snapshot outranks a newer edit to an earlier month

**Filed** 2026-09-11. **Not built** — found during the Cards past-month
navigation diagnosis (finding "(c)") and deliberately kept out of that change,
which made *closed* cycles snapshot-only but left the open/future carry-forward
rule exactly as it was.

**Status:** open, unscheduled. **Live in the founder's household today.**

---

## The problem

Card plans are stored as per-month snapshots: `monthly_goals` (one row per
household/card/month) and `card_envelope_items` (one row per
household/card/category/month). The only writer is `POST /api/card-envelope`,
which saves exactly the month being edited.

For an open or future month with no snapshot of its own, the plan is
**carried forward**: the nearest saved month *at or before* it wins
(`carryForwardMap`, [src/lib/envelopeHelpers.ts](../../src/lib/envelopeHelpers.ts)).
That rule only ever looks **backward from a gap**. It never looks **forward
from an edit**. So a snapshot saved *earlier in time* for a *later month* keeps
winning over a *more recent* edit to an *earlier month*.

### The live example

Visa Avion (household `2be22642…`), as queried 2026-09-11:

| Month snapshot | Saved on | Groceries & Pharmacy | Card goal |
|---|---|---|---|
| 2026-09 | 2026-09-09 (category rows' last save) | **$200** | $2,850 |
| 2026-10 | 2026-08-06 | $550 | $2,400 |
| 2026-11 | 2026-08-06 | $550 | $2,400 |
| 2026-12 | 2026-08-06 | $550 | $2,400 |

The family's most recent decision (Sep 9) was Groceries $200. October,
November and December still show $550, because each has its own older
snapshot, saved on Aug 6, before that decision. January 2027 onward carries
December's $550 forward.

(`monthly_goals.created_at` is the first-insert time only — the row is
upserted — so the goal column's edit dates are not actually knowable; see
"No edit history" below.)

## Why it is bigger than the grid

The two existing resolution rules already disagree (diagnosis finding "(a)"):

- **Exact month only**: decision-view category rows
  ([src/app/api/card-envelope/route.ts](../../src/app/api/card-envelope/route.ts),
  `.eq('month', monthStart)`), and the coaching layer's over-target detection
  ([src/lib/monthlyReviewService.ts](../../src/lib/monthlyReviewService.ts),
  `card_envelope_items` for the live cycle month).
- **Carry-forward, nearest at or before**: the grid's items and goals
  (`buildGrid` → `carryForwardMap`), the decision view's and cross-card
  overview's goal for open/future months
  ([src/lib/cardPlanServer.ts](../../src/lib/cardPlanServer.ts)
  `fetchCardGoalForMonth`), the Timeline's 12-month plan chain
  (`resolveCardBudgetsForCycle`,
  [src/lib/planChainHelpers.ts](../../src/lib/planChainHelpers.ts), fed by
  [src/app/api/timeline/route.ts](../../src/app/api/timeline/route.ts)'s
  `monthly_goals` read), and the dashboard's projection
  ([src/lib/projectionHelpers.ts](../../src/lib/projectionHelpers.ts)).

So the stale October goal ($2,400) is not just a grid label. It is the card
cost the Timeline's plan chain projects for October's cycle.

## Why it was not fixed with the past-month work

- It is a defect in the carry-forward rule itself, independent of whether
  past months can be viewed.
- Fixing it means choosing, repo-wide, which rule wins, and every surface
  above has to move together, or the decision view and the grid will disagree
  on one screen, which is the exact failure the 2026-09-11 change was careful
  to avoid for closed months.

## Questions the fix has to answer first

1. When a family edits month M, what should happen to months after M that
   already have their own saved snapshot? Options: leave them (today's
   behaviour); overwrite them; or ask ("Apply to later months too?"), which
   would make the choice explicit at save time rather than guessing it at
   read time.
2. Should "latest *saved*" (by time) ever outrank "latest *month*"? That needs
   a trustworthy save time per snapshot. `card_envelope_items.created_at` is
   one (rows are deleted and re-inserted on every save); `monthly_goals` has
   none (upserted, no `updated_at`).
3. Should the decision view's category rows switch to carry-forward, or the
   grid's switch to exact-month, for open/future months? Today they disagree
   for any open month without its own snapshot.
4. The coaching layer reads exact-month only. Whatever wins, the monthly
   review must judge against the same plan the family sees on the Cards page.

## No edit history

Nothing records *when* a `monthly_goals` row last changed, and nothing records
prior values of either table. If question 2's answer is "by save time", that
needs a column (`updated_at` on `monthly_goals`) or an append-only history
table first. Note: closed cycles are now write-locked
(`POST /api/card-envelope` → 409 `cycle_closed`), so from 2026-09-11 a past
month's snapshot can no longer change after its statement closes.
