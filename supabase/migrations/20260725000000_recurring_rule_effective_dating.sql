-- =============================================================================
-- Phare — Timeline Part B: effective-dated recurring rule changes
-- (split-into-two-rules model, founder-approved 2026-07-21).
-- Strictly additive. No ALTER on existing column types/constraints.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
-- =============================================================================

-- Editing a recurring rule's amount/cadence/anchor/second_day now splits the
-- rule instead of mutating it in place: the current row is frozen (active =
-- false — already the exact flag dashboard/goals queries filter on) and a
-- NEW row takes over from an effective date forward. These two columns are
-- what make that split legible and self-contained:
--
--   effective_from — the date this row's value/cadence actually starts
--                     applying. NULL for a rule that has never been split
--                     (its value has applied since inception).
--   predecessor_id  — the rule row this one continues from, for traceability
--                     (a "view history" affordance can walk this chain later
--                     — not built yet, see the Timeline Part B handoff).
--
-- Both are consulted by PATCH /api/recurring/[id]'s split path; existing
-- rows are entirely unaffected (both new columns default to NULL, and
-- `active` already defaults to true — every pre-existing rule stays exactly
-- as it reads today).
ALTER TABLE recurring_items ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE recurring_items ADD COLUMN IF NOT EXISTS predecessor_id uuid REFERENCES recurring_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_items_predecessor
  ON recurring_items (predecessor_id);
