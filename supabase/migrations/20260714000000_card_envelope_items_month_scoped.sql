-- =============================================================================
-- Phare — Build 2 completion: month-scope card_envelope_items
-- Sub-budgets were a single global template per card (see 20260703000000
-- comment: "persistent template, not month-scoped"). That meant editing this
-- month's category amounts silently rewrote every other month's too. This
-- makes card_envelope_items per-month, matching monthly_goals, so the
-- envelope editor's "copy from previous month" button has something real to
-- copy — editing August after copying from July leaves July's saved rows
-- untouched.
--
-- Existing rows are backfilled to the current calendar month (the only
-- month that had any meaningful data under the old global model). Every
-- other month starts empty until the user explicitly copies forward.
-- =============================================================================

ALTER TABLE card_envelope_items ADD COLUMN IF NOT EXISTS month date;

UPDATE card_envelope_items
SET month = date_trunc('month', now())::date
WHERE month IS NULL;

ALTER TABLE card_envelope_items ALTER COLUMN month SET NOT NULL;

-- Drop the old (household_id, account_id, category_id) unique constraint by
-- looking it up structurally instead of guessing its auto-generated name —
-- if the name guess were wrong, the old constraint would silently survive
-- and keep blocking two months from having the same category, defeating the
-- whole point of this migration.
DO $$
DECLARE
  old_constraint text;
BEGIN
  SELECT con.conname INTO old_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'card_envelope_items'
    AND con.contype = 'u'
    AND con.conkey = (
      SELECT array_agg(attnum ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = rel.oid
        AND attname IN ('household_id', 'account_id', 'category_id')
    );

  IF old_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE card_envelope_items DROP CONSTRAINT %I', old_constraint);
  END IF;
END $$;

ALTER TABLE card_envelope_items
  DROP CONSTRAINT IF EXISTS card_envelope_items_household_account_category_month_key;
ALTER TABLE card_envelope_items
  ADD CONSTRAINT card_envelope_items_household_account_category_month_key
  UNIQUE (household_id, account_id, category_id, month);

DROP INDEX IF EXISTS idx_card_envelope_items_account;
CREATE INDEX IF NOT EXISTS idx_card_envelope_items_account_month
  ON card_envelope_items (account_id, month);
