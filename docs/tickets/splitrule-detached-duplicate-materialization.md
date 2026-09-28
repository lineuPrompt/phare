# splitRule can materialize a duplicate set of future rows

**Filed** 2026-09-28, from the backlog reconciliation. The occurrence was
reported by Lineu (44 duplicate rows, once); not yet reproduced here.

**Status:** OPEN. Diagnose and stop for approval (dates / materialization).

**Severity:** high when it fires: duplicated plan rows double future
expenses on the Timeline and in every figure built from the plan.

---

## The mechanism, as read from the code

`splitRule` in [src/app/api/recurring/[id]/route.ts](../../src/app/api/recurring/%5Bid%5D/route.ts)
(from line 308), for an amount/cadence/anchor edit effective from a date:

1. deletes the old rule's future rows — `.eq('recurring_item_id', oldRuleId)
   .gte('date', effectiveFrom)` (around line 360);
2. inserts the new rule;
3. carries the old rule's tombstones (`recurring_skipped_dates`) on/after the
   boundary to the new rule;
4. materializes the new rule from `effectiveFrom`, excluding tombstoned dates.

An ordinary detached occurrence (edited through `/api/expenses/[id]`) is
covered: it has a tombstone, so step 4 skips its date.

**The hypothesis for the diagnosis:** a future row whose `recurring_item_id`
became NULL **without** a tombstone is matched by neither step 1 (it no longer
carries the rule id) nor step 4 (no tombstone). Step 4 then materializes that
date again. Candidates for how such rows arise: an `ON DELETE SET NULL` from a
rule row being deleted or replaced (save-plan's replace path), or rows
detached before tombstones existed.

## What the diagnosis needs to answer

- Which path produced the 44 rows (query live data: detached future rows with
  no tombstone, grouped by what they look like).
- Whether the fix is in `splitRule` (match detached rows by
  description/amount/date?) or in whatever detaches without a tombstone.
- Whether the live data needs a one-off repair `.sql`.
