-- =============================================================================
-- Phare — harden handle_new_user against empty-string household_id
-- 2026-06-23
--
-- The previous migration (20260623000000) checked:
--     IF provisioned_household_id IS NOT NULL THEN
--
-- An empty string ('') satisfies IS NOT NULL but fails the ::uuid cast,
-- rolling back the entire signup transaction. While the endpoint never
-- sends an empty string today, this guard prevents any future code path
-- from tripping that landmine.
--
-- Fix: change the condition to:
--     IF provisioned_household_id IS NOT NULL AND provisioned_household_id != '' THEN
--
-- Behaviour changes:
--   • household_id = NULL (normal self-signup) → Path A, unchanged.
--   • household_id = '' (malformed metadata)  → falls through to Path A,
--     creating a new household. Safe default: no crash, no data corruption.
--   • household_id = valid UUID (provisioned)  → Path B, unchanged.
--
-- After applying: run `SELECT prosrc FROM pg_proc WHERE proname='handle_new_user'`
-- and confirm the condition reads `IS NOT NULL AND provisioned_household_id != ''`.
-- Then do a test self-signup and confirm exactly one household + one chequing is
-- created — the load-bearing Path A regression check.
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_household_id         uuid;
  member_name              text;
  provisioned_household_id text;
  provisioned_role         text;
BEGIN
  member_name              := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  provisioned_household_id := NEW.raw_user_meta_data->>'household_id';

  IF provisioned_household_id IS NOT NULL AND provisioned_household_id != '' THEN
    -- -----------------------------------------------------------------------
    -- Path B — provisioned member
    -- Attach to the existing household; no new household, no chequing.
    -- -----------------------------------------------------------------------
    provisioned_role := COALESCE(NEW.raw_user_meta_data->>'role', 'member');

    INSERT INTO users (id, household_id, email, full_name, role)
      VALUES (
        NEW.id,
        provisioned_household_id::uuid,
        NEW.email,
        member_name,
        provisioned_role
      );

    INSERT INTO household_members (household_id, user_id, name)
      VALUES (provisioned_household_id::uuid, NEW.id, member_name);

  ELSE
    -- -----------------------------------------------------------------------
    -- Path A — normal self-signup (unchanged from original trigger)
    -- Also handles the malformed-empty-string case safely.
    -- -----------------------------------------------------------------------
    INSERT INTO households (name, locale)
      VALUES (
        member_name,
        COALESCE(NEW.raw_user_meta_data->>'locale', 'en')
      )
      RETURNING id INTO new_household_id;

    INSERT INTO users (id, household_id, email, full_name, role)
      VALUES (NEW.id, new_household_id, NEW.email, member_name, 'owner');

    INSERT INTO household_members (household_id, user_id, name)
      VALUES (new_household_id, NEW.id, member_name);

    INSERT INTO accounts (household_id, name, type)
      VALUES (new_household_id, 'Chequing', 'chequing');

  END IF;

  RETURN NEW;
END;
$$;
