-- =============================================================================
-- Phare — safety net: guarantee UNIQUE(household_id, account_id, category_id,
-- month) exists on card_envelope_items.
--
-- 20260714000000 was supposed to add this, but the DB was only confirmed
-- duplicate-free by a manual dedupe query, not by re-checking the
-- constraint itself. This migration is idempotent — checks structurally
-- (by column set, not by name) whether the constraint already exists and
-- only adds it if missing, so running this after 20260714000000 is a no-op.
-- The editor's save flow (delete-then-insert, scoped to one household +
-- account + month) relies on this constraint as the backstop against a
-- second concurrent save ever producing two rows for the same category in
-- the same month — duplicates become structurally impossible, not merely
-- absent from today's data.
-- =============================================================================

DO $$
DECLARE
  has_constraint boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'card_envelope_items'
      AND con.contype = 'u'
      AND con.conkey = (
        SELECT array_agg(attnum ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = rel.oid
          AND attname IN ('household_id', 'account_id', 'category_id', 'month')
      )
  ) INTO has_constraint;

  IF NOT has_constraint THEN
    ALTER TABLE card_envelope_items
      ADD CONSTRAINT card_envelope_items_household_account_category_month_key
      UNIQUE (household_id, account_id, category_id, month);
  END IF;
END $$;
