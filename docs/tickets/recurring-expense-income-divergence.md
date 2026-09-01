# Recurring expense/income rows can be edited into divergence on the Timeline

**Filed** 2026-09-01. **Not built** — deliberately out of scope for the
Timeline transfer work of the same date, which was itself cancelled down to
the `sourceHref` fix.

**Status:** open, unscheduled. Nobody has been observed hitting this.

---

## The problem

`DayLedger`'s `EntryControls` ([src/components/timeline/DayLedger.tsx:159](../../src/components/timeline/DayLedger.tsx#L159))
edits income and expense rows through `PATCH /api/expenses/[id]`. That route
runs the identical detach-on-edit the transfer route does — `tombstoneOccurrence`
at [src/app/api/expenses/[id]/route.ts:31-55](../../src/app/api/expenses/%5Bid%5D/route.ts#L31-L55):
tombstone the occurrence's original date, clear `recurring_item_id`, then
apply the edit.

So a materialized occurrence of a recurring **expense** or **income** rule can
be edited into disagreeing with the rule that produced it, exactly as goal
contributions could before 2026-08-31.

### The example, as diagnosed

> Edit next month's $2,000 mortgage row to $2,500 and the `/recurring` page
> still says $2,000 while the Timeline says $2,500, with no join surviving to
> connect them and no drift notice anywhere (the drift check I built covers
> goal and buffer accounts only).

## Why it was not folded into the transfer work

Two differences, both recorded at diagnosis time:

- **It is more consequential, not less.** Recurring expenses and income drive
  the plan, the budget comparison, and the monthly review — more surfaces read
  those figures than read goal contributions.
- **It has no editor to redirect to yet.** `/recurring` has a full rule editor
  with an effective-date picker
  ([RecurringList.tsx:71-95](../../src/components/recurring/RecurringList.tsx#L71-L95)),
  so the destination exists — but unlike goals, there is no per-row equivalent
  of the contribution editor. The redirect is a page, not a control.

## What a fix would need

Roughly the shape that was designed for transfers and then cancelled:

1. **Rule liveness on the Timeline.** `recurring_item_id` is already in
   `TRANSACTION_COLUMNS` ([timeline/route.ts:23-24](../../src/app/api/timeline/route.ts#L23-L24)),
   but `active` is not, and the route fetches no `recurring_items` rows. A row
   attached to a *frozen* predecessor rule must not be restricted — that rule
   refuses edits, so there would be nowhere to send the household. One extra
   query over the distinct rule ids in the window covers it.
2. **Amount read-only** on a future occurrence of a live rule; date,
   description and delete stay.
3. **Server-side refusal** in `PATCH /api/expenses/[id]` so the rule holds
   regardless of caller.
4. **A drift check for non-goal accounts.** `computeContributionDrift`
   ([src/lib/contributionDrift.ts](../../src/lib/contributionDrift.ts)) is
   written against one account's future rows vs. one rule amount and would
   generalise, but nothing currently computes or displays it outside
   `api/goals` and `api/sinking-funds`. Note the `effective_from` exclusion —
   a future row predating the current rule is the forward-apply guarantee
   working, not drift.

## Counter-argument on file

The same reasoning that cancelled the transfer work applies here and is
stronger, since there is no evidence at all for this one:

- No observed instance in production.
- The `detachHint` copy already warns at the point of edit — *"This is part of
  a recurring rule. Saving edits only this occurrence — the rule itself is
  unchanged."*
- Editing a single occurrence is sometimes exactly right (one month's bill
  really was different), and for income/expense there is no second surface
  contradicting itself the way a goal card did.

The case for building it is a summary that lies; the case against is that no
such summary exists for these rows today. **Revisit if a plan-vs-actual or
budget surface starts reporting a rule amount next to materialized rows.**
