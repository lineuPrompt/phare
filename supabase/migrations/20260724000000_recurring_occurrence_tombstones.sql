-- =============================================================================
-- Phare — Timeline edit/delete Part A3: detach-on-edit for materialized
-- recurring occurrences.
-- Strictly additive. No ALTER on existing tables.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
-- =============================================================================

-- When a single materialized occurrence of a recurring rule is edited or
-- deleted, it detaches from the rule (transactions.recurring_item_id is
-- cleared, or the row is removed outright). Without a record of that, the
-- next time the RULE itself is edited, PATCH /api/recurring/[id]'s
-- delete-and-rematerialize step would regenerate that date fresh under the
-- rule's own value — silently reverting an edit or resurrecting a deleted
-- occurrence. This table is that record: "rule X must never regenerate an
-- occurrence dated Y again." It is consulted by both POST /api/recurring
-- (initial materialization — always empty for a brand-new rule id) and
-- PATCH /api/recurring/[id] (re-materialization) before inserting any date.
CREATE TABLE IF NOT EXISTS recurring_skipped_dates (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid        NOT NULL REFERENCES households(id)       ON DELETE CASCADE,
  recurring_item_id  uuid        NOT NULL REFERENCES recurring_items(id)  ON DELETE CASCADE,
  date               date        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- One tombstone per rule per date — detaching the same date twice is a no-op.
  UNIQUE (recurring_item_id, date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_skipped_dates_item
  ON recurring_skipped_dates (recurring_item_id);

CREATE INDEX IF NOT EXISTS idx_recurring_skipped_dates_household
  ON recurring_skipped_dates (household_id);

ALTER TABLE recurring_skipped_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_skipped_dates_household_all" ON recurring_skipped_dates
  FOR ALL USING (
    household_id = (SELECT household_id FROM public.users WHERE id = auth.uid())
  );
