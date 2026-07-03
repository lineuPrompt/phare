-- =============================================================================
-- Phare — Build 3: Opening-balance anchor for the Cash Timeline
-- Strictly additive. No ALTER on existing tables.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
-- =============================================================================

-- A user states "my chequing had $X on date Y." Everything derives from there.
-- Multiple anchors may exist per account; the timeline selects the most recent
-- one at or before the window start as the effective starting point.
-- A corrective anchor mid-window resets the running balance on that day,
-- allowing the user to reconcile drift between computed and actual balances.
CREATE TABLE IF NOT EXISTS account_balance_anchors (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid          NOT NULL REFERENCES households(id)  ON DELETE CASCADE,
  account_id    uuid          NOT NULL REFERENCES accounts(id)    ON DELETE CASCADE,
  anchor_date   date          NOT NULL,
  balance       numeric(12,2) NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  -- One anchor per account per date; a corrective anchor replaces via upsert.
  UNIQUE (account_id, anchor_date)
);

-- Fast lookup: "all anchors at or before date X for account Y, descending"
CREATE INDEX IF NOT EXISTS idx_anchors_account_date
  ON account_balance_anchors (account_id, anchor_date DESC);

CREATE INDEX IF NOT EXISTS idx_anchors_household
  ON account_balance_anchors (household_id);

ALTER TABLE account_balance_anchors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anchors_household_all" ON account_balance_anchors
  FOR ALL USING (
    household_id = (SELECT household_id FROM public.users WHERE id = auth.uid())
  );
