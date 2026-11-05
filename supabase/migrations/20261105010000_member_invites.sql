-- =============================================================================
-- Phare — invites join a household through a server-only table, member_invites.
-- 2026-11-05. Lineu: "yes invite fix".
--
-- STATUS: APPLIED 2026-11-05 by Lineu; VERIFY 10/10 PASS (run live by
--   Claude). PROVEN LIVE the same day, after the deploy (2deeeda):
--   - a real invite (Rocky Test → fern.tick…) joined Rocky Test as member,
--     no stray household, the member_invites row consumed;
--   - a public signUp carrying household_id = Rocky Test and role = owner in
--     its metadata got a household of its own ("Summit Forged"), Rocky Test
--     unchanged at 2 users; its signup event recorded platform 'web'.
--   Every test account and household was then deleted through the app's own
--   deletion routes; 0 left, 0 pending invites.
--
-- APPLY ORDER: this migration FIRST, then deploy the route change
-- (src/app/api/household/members/route.ts, same change). Until both are in,
-- invites do not work — exactly as since 20261105000000 — and with this
-- migration applied before the deploy, the old route still gives an invitee a
-- household of its own. Send no invite until the deploy is live.
--
-- WHAT WENT WRONG WITH 20261105000000
-- -----------------------------------
-- It moved Path B's household and role from raw_user_meta_data (client
-- writable: the security hole) to raw_app_meta_data (service role only). Its
-- VERIFY passed 9/9 — all of it read the function's TEXT. The live invite test
-- then showed the invitee in a NEW household, as owner, with app_metadata
-- holding the right household: GoTrue's admin createUser INSERTs the auth user
-- with app_metadata = {provider, providers} and sets the custom keys in a
-- later UPDATE. The AFTER INSERT trigger never sees them.
--
-- THE FIX
-- -------
-- The invite route writes (email, household_id, role) to member_invites BEFORE
-- it creates the auth user. handle_new_user looks the new user's email up
-- there: a row means Path B, into that row's household with that row's role,
-- and the row is consumed. No row means Path A, a new household, whatever the
-- sign-up's metadata says. member_invites has RLS on and no policies, and
-- anon/authenticated hold no privilege on it: only the service role (the
-- route) and this SECURITY DEFINER function can read or write it.
--
-- A row for an address can only help the person who controls that address:
-- an unconfirmed account cannot sign in (email confirmation is on), and the
-- route creates the auth user right after writing the row and drops the row
-- if that fails. The route then reads the new users row back and refuses to
-- report success unless it landed in the inviting household.
--
-- The rest of the body is the live 20261105000000 body (prosrc read
-- 2026-11-05), changes marked CHANGED. Same signature, SECURITY DEFINER,
-- search_path=public: a replace, never an overload.
-- =============================================================================

CREATE TABLE IF NOT EXISTS member_invites (
  email        text        PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('member', 'owner')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE member_invites IS
  'Pending invites, written by POST /api/household/members (service role) just before it creates the auth user; consumed by handle_new_user. The only source of a household for a new account other than its own new one.';

ALTER TABLE member_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_invites TO service_role;


CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_household_id         uuid;
  member_name              text;
  provisioned_household_id uuid;
  provisioned_role         text;
BEGIN
  member_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));

  -- CHANGED 2026-11-05: the household comes from a pending invite for this
  -- email (member_invites, server-only), consumed here. Never from metadata.
  DELETE FROM member_invites
   WHERE email = lower(btrim(NEW.email))
  RETURNING household_id, role INTO provisioned_household_id, provisioned_role;

  IF provisioned_household_id IS NOT NULL THEN
    -- -----------------------------------------------------------------------
    -- Path B — provisioned member
    -- Attach to the existing household; no new household, no chequing.
    -- No 'signup' event: no household was born here.
    -- -----------------------------------------------------------------------
    INSERT INTO users (id, household_id, email, full_name, role)
      VALUES (
        NEW.id,
        provisioned_household_id,
        NEW.email,
        member_name,
        provisioned_role
      );

    INSERT INTO household_members (household_id, user_id, name)
      VALUES (provisioned_household_id, NEW.id, member_name);

  ELSE
    -- -----------------------------------------------------------------------
    -- Path A — normal self-signup
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

    -- Diary: record the moment this household was born. Locale and platform
    -- only ('mobile' or 'web') — no name, no email. SECURITY DEFINER bypasses
    -- the events_all RLS policy.
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
-- VERIFY — run AFTER applying, in the SQL Editor. Every line must say PASS.
-- These read structure only. The proof is the live test after the deploy: a
-- real invite joins the household, a sign-up carrying household_id metadata
-- gets its own.
-- =============================================================================
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'member_invites exists, RLS on' AS check_name,
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_invites'::regclass), false) AS ok
  UNION ALL
  SELECT 'no client privilege on member_invites',
         NOT has_table_privilege('anon', 'public.member_invites', 'SELECT,INSERT,UPDATE,DELETE')
     AND NOT has_table_privilege('authenticated', 'public.member_invites', 'SELECT,INSERT,UPDATE,DELETE')
  UNION ALL
  SELECT 'service role can write member_invites',
         has_table_privilege('service_role', 'public.member_invites', 'INSERT,DELETE')
  UNION ALL
  SELECT 'no policy on member_invites',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'member_invites')
  UNION ALL
  SELECT 'one function, no overload',
         (SELECT count(*) FROM pg_proc WHERE proname = 'handle_new_user') = 1
  UNION ALL
  SELECT 'household from member_invites, consumed',
         (SELECT prosrc LIKE '%DELETE FROM member_invites%' AND prosrc LIKE '%RETURNING household_id, role INTO provisioned_household_id, provisioned_role%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'no household or role from any metadata',
         (SELECT prosrc NOT LIKE '%meta_data->>''household_id''%' AND prosrc NOT LIKE '%meta_data->>''role''%' FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'Path A intact: household, member, chequing, signup with platform',
         (SELECT prosrc LIKE '%INSERT INTO households%' AND prosrc LIKE '%INSERT INTO household_members%'
             AND prosrc LIKE '%''Chequing'', ''chequing''%' AND prosrc LIKE '%''signup''%' AND prosrc LIKE '%''platform''%'
            FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'security definer, search_path public',
         (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE proname = 'handle_new_user')
  UNION ALL
  SELECT 'trigger still bound and enabled',
         EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE p.proname = 'handle_new_user' AND t.tgname = 'on_auth_user_created' AND t.tgenabled = 'O')
) checks;
