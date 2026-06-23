-- =============================================================================
-- Phare — household member provisioning
-- 2026-06-23
--
-- Modifies handle_new_user to support two paths:
--
--   A. Normal self-signup (raw_user_meta_data has NO household_id):
--      Behaviour is byte-for-byte identical to the original trigger.
--      Creates: household → users (owner) → household_members → accounts (Chequing).
--
--   B. Provisioned member (raw_user_meta_data HAS a household_id):
--      The Admin API set this metadata when calling auth.admin.createUser().
--      Creates: users row + household_members row pointing at the EXISTING household.
--      Does NOT create a new household or chequing account.
--
-- Metadata contract (set by the provisioning endpoint, read here):
--   household_id  uuid text  — the owner's household id
--   role          text       — 'member' (default) or 'owner'
--   full_name     text       — display name (same key as self-signup)
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

  IF provisioned_household_id IS NOT NULL THEN
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

-- The trigger itself is already on auth.users from the initial migration.
-- No DROP/CREATE trigger needed — the function replacement is sufficient.
