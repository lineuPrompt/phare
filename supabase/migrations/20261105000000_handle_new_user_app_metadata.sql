-- =============================================================================
-- Phare — handle_new_user: the household and role come from app_metadata only;
-- the signup event records its platform.
-- 2026-11-05. Lineu: "yes security".
--
-- STATUS: WRITTEN, NOT APPLIED.
--
-- APPLY ORDER: AFTER the deploy that makes the invite route write
-- app_metadata (src/app/api/household/members/route.ts, same change).
-- Applied before it, an invite made in between would create a NEW household
-- for the invitee instead of joining yours. (The invite route also still
-- writes user_metadata, so the old trigger keeps working until this lands.)
--
-- THE HOLE (docs/tickets/signup-metadata-joins-any-household.md)
-- --------------------------------------------------------------
-- The live body (md5 3552de0f65e1a14014472a995e865380, length 2593) takes
-- Path B — join an existing household — whenever
-- raw_user_meta_data->>'household_id' is set, with
-- raw_user_meta_data->>'role' as the role. raw_user_meta_data is the
-- CLIENT's field: supabase.auth.signUp({ options: { data: {...} } }) with the
-- public key writes whatever it likes there. Anyone who knew a household's id
-- could create an account inside it, as owner.
--
-- raw_app_meta_data can only be written with the service role
-- (auth.admin.createUser({ app_metadata })). Reading Path B's household and
-- role from there closes it. A self-sign-up that sends household_id now gets
-- a household of its own, like any other sign-up.
--
-- Exposure, read 2026-11-05: only two users ever joined an existing household,
-- both real invites. No sign of abuse.
--
-- ALSO: the signup event's metadata gains `platform`: 'mobile' when the app
-- signed the person up (signUpParams, apps/mobile/src/lib/signUp.ts), 'web'
-- otherwise. Never the raw value: an allowlist, so the field can only hold
-- those two words.
--
-- DIFFED AGAINST THE LIVE BODY (prosrc, read 2026-11-05), not against an older
-- migration. The only changes are marked CHANGED below. Same signature, same
-- SECURITY DEFINER, same search_path (proconfig search_path=public): a
-- replace, never an overload. The VERIFY block reads prosrc back.
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
  -- CHANGED 2026-11-05: app_metadata, writable by the service role only.
  provisioned_household_id := NEW.raw_app_meta_data->>'household_id';

  IF provisioned_household_id IS NOT NULL AND provisioned_household_id != '' THEN
    -- -----------------------------------------------------------------------
    -- Path B — provisioned member
    -- Attach to the existing household; no new household, no chequing.
    -- No 'signup' event: no household was born here. See the banner.
    -- -----------------------------------------------------------------------
    -- CHANGED 2026-11-05: app_metadata, as above.
    provisioned_role := COALESCE(NEW.raw_app_meta_data->>'role', 'member');

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
    -- Path A — normal self-signup
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

    -- RESTORED 2026-09-04. Diary: record the moment this household was born.
    -- Metadata carries locale only — no name, no email. The trigger runs
    -- SECURITY DEFINER so it bypasses the events_all RLS policy, which is why
    -- no policy change is needed here.
    -- CHANGED 2026-11-05: and the platform, 'mobile' or 'web' only.
    INSERT INTO events (household_id, user_id, event_type, metadata)
      VALUES (
        new_household_id,
        NEW.id,
        'signup',
        jsonb_build_object(
          'locale', COALESCE(NEW.raw_user_meta_data->>'locale', 'en'),
          'platform', CASE WHEN NEW.raw_user_meta_data->>'platform' = 'mobile' THEN 'mobile' ELSE 'web' END
        )
      );

  END IF;

  RETURN NEW;
END;
$$;


-- =============================================================================
-- VERIFY — run AFTER applying, in the SQL Editor. Each line must say PASS.
-- =============================================================================
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'one function, no overload' AS check_name,
         (SELECT count(*) FROM pg_proc WHERE proname = 'handle_new_user') = 1 AS ok
  UNION ALL
  SELECT 'household read from app_metadata',
         (SELECT prosrc LIKE '%NEW.raw_app_meta_data->>''household_id''%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'role read from app_metadata',
         (SELECT prosrc LIKE '%NEW.raw_app_meta_data->>''role''%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'nothing read from user_metadata for household or role',
         (SELECT prosrc NOT LIKE '%raw_user_meta_data->>''household_id''%'
             AND prosrc NOT LIKE '%raw_user_meta_data->>''role''%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'signup event still written, with platform',
         (SELECT prosrc LIKE '%''signup''%' AND prosrc LIKE '%''platform''%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'empty-string guard and Path B kept',
         (SELECT prosrc LIKE '%provisioned_household_id != ''''%' AND prosrc LIKE '%Path B%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'Path A still creates the household, member and chequing',
         (SELECT prosrc LIKE '%INSERT INTO households%' AND prosrc LIKE '%INSERT INTO household_members%'
             AND prosrc LIKE '%''Chequing'', ''chequing''%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'security definer, search_path public',
         (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'trigger still bound and enabled',
         EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE p.proname = 'handle_new_user' AND t.tgname = 'on_auth_user_created' AND t.tgenabled = 'O')
) checks;
