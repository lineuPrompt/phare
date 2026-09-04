-- =============================================================================
-- Phare — restore the 'signup' event to handle_new_user
-- 2026-09-04.
--
-- STATUS: PENDING APPLICATION as of writing. Apply in the SQL Editor, then run
--   the VERIFY block at the bottom and record the result in this banner.
--
-- WHAT BROKE, AND WHEN
-- --------------------
-- 20260620000000_event_log.sql added an `INSERT INTO events (… 'signup' …)` to
-- the end of handle_new_user, so every household creation left a row.
--
-- Three days later 20260623000000_member_provisioning.sql did a
-- CREATE OR REPLACE FUNCTION handle_new_user() to add the provisioned-member
-- path (Path B), and rewrote the body WITHOUT that insert.
-- 20260623000001_trigger_harden_empty_household.sql then replaced it again
-- (the empty-string guard) from the same events-less body, and that is what
-- has been live ever since.
--
-- So: NO household created after 2026-06-23 has a 'signup' row. The event type
-- is still declared in eventLogger.ts's EventType union and is still named in
-- 20260620000000's own verification query, which is what made this invisible —
-- everything referencing it looks alive.
--
-- This is the CREATE OR REPLACE hazard one level down from the overload case.
-- The signature never changed, so no second overload was created and nothing
-- errored; the *body* silently lost a clause. A migration that replaces a
-- function must be diffed against the live prosrc, not against whichever
-- migration is assumed to be current.
--
-- WHY IT MATTERS ENOUGH TO GET ITS OWN FILE
-- -----------------------------------------
-- 'signup' is the denominator. Every funnel ratio worth computing is
-- X / signups. Without it the event stream has no cohort to divide by, and
-- "three households signed in and did nothing" cannot be stated as a rate.
--
-- WHAT THIS FILE DOES
-- -------------------
--   Step 1 — restores the insert on Path A. The rest of the body is the live
--            20260623000001 definition unchanged, empty-string guard and all;
--            the VERIFY block re-asserts that guard so this file cannot be the
--            thing that loses it next.
--   Step 2 — backfills the missing rows from households.created_at, which is
--            an exact record of the fact the events table lost. OPTIONAL and
--            separable; see its own header.
--
-- PATH B DELIBERATELY EMITS NOTHING. A provisioned member joining an existing
-- household is not a signup — it creates no household, and counting it would
-- inflate the very denominator this file exists to make trustworthy, with
-- people who were never asked to onboard. The natural event for that is
-- 'added_second_family_member', which is declared in eventLogger.ts and
-- emitted by nothing; wiring it is separate work and is NOT done here.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — the function
--
-- Diffed against the live body (20260623000001). The ONLY change is the
-- INSERT INTO events at the end of the Path A branch. Everything else,
-- including `provisioned_household_id != ''`, is unchanged.
-- ---------------------------------------------------------------------------
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
    -- No 'signup' event: no household was born here. See the banner.
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
    INSERT INTO events (household_id, user_id, event_type, metadata)
      VALUES (
        new_household_id,
        NEW.id,
        'signup',
        jsonb_build_object('locale', COALESCE(NEW.raw_user_meta_data->>'locale', 'en'))
      );

  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- STEP 2 — backfill the rows lost between 2026-06-23 and today
--
-- OPTIONAL. Step 1 stands alone; skip this and the funnel simply starts today.
-- Run it if you want the cohort that prompted this work to be countable — the
-- households already in the table have no 'signup' row and never will
-- otherwise.
--
-- HONEST BY CONSTRUCTION, in three ways:
--   1. created_at is set to households.created_at, so a backfilled row claims
--      the time the household was actually born, not the time this ran.
--   2. Every backfilled row carries metadata.backfilled = true. Nothing here
--      is ever mistakable for a live emission, and a query that wants only
--      genuine trigger output can filter it out.
--   3. user_id comes from the household's owner in `users`, LEFT JOINed — a
--      household whose owner has since deleted their account gets a NULL
--      user_id, which is exactly what the live path would hold today anyway
--      (events.user_id is ON DELETE SET NULL).
--
-- IDEMPOTENT: the NOT EXISTS guard means re-running inserts nothing. Safe to
-- run twice, safe to run after Step 1 has already produced live rows.
-- ---------------------------------------------------------------------------
INSERT INTO events (household_id, user_id, event_type, metadata, created_at)
SELECT
  h.id,
  owner.id,
  'signup',
  jsonb_build_object(
    'locale', COALESCE(h.locale, 'en'),
    'backfilled', true,
    'source', 'households.created_at'
  ),
  h.created_at
FROM households h
LEFT JOIN LATERAL (
  SELECT u.id
    FROM users u
   WHERE u.household_id = h.id
     AND u.role = 'owner'
   ORDER BY u.created_at
   LIMIT 1
) owner ON true
WHERE NOT EXISTS (
  SELECT 1 FROM events e
   WHERE e.household_id = h.id
     AND e.event_type = 'signup'
);


-- =============================================================================
-- VERIFY — run AFTER applying, in the SQL Editor.
--
-- The point of this block is that it reads the LIVE FUNCTION BODY. "The
-- migration ran without error" is exactly the evidence that was available in
-- June and it was worthless: 20260623000000 ran cleanly and still destroyed
-- the insert. prosrc is the only thing that answers the question being asked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CHECK 1 (the load-bearing one) — is the insert actually in the live body?
--
-- Expect ONE row, with every boolean column true and overload_count = 1.
--
--   has_events_insert          the INSERT INTO events survived this replace
--   has_signup_literal         and it is the 'signup' one specifically
--   has_empty_string_guard     20260623000001's fix was not regressed by us
--   has_path_b                 the provisioned-member branch is still there
--   is_security_definer        still bypasses RLS, or the insert will fail
--   overload_count             1 — a second row here means a NEW OVERLOAD was
--                              created rather than the existing function
--                              replaced, and the trigger may still be bound to
--                              the old one. Any value but 1 is a stop.
-- -----------------------------------------------------------------------------
SELECT
  p.proname,
  (p.prosrc LIKE '%INSERT INTO events%')                    AS has_events_insert,
  (p.prosrc LIKE '%''signup''%')                            AS has_signup_literal,
  (p.prosrc LIKE '%provisioned_household_id != ''''%')      AS has_empty_string_guard,
  (p.prosrc LIKE '%Path B%')                                AS has_path_b,
  p.prosecdef                                               AS is_security_definer,
  count(*) OVER ()                                          AS overload_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'handle_new_user'
  AND n.nspname = 'public';

-- -----------------------------------------------------------------------------
-- CHECK 2 — the trigger is bound to that function, on the table you think.
-- Expect one row: the trigger 20260618000000 created, on auth.users, with a
-- function_oid matching the function CHECK 1 just inspected, and tgenabled='O'
-- (enabled). A missing row here means the function is correct and nothing
-- calls it.
-- -----------------------------------------------------------------------------
SELECT
  t.tgname,
  c.relnamespace::regnamespace || '.' || c.relname AS on_table,
  p.oid                                            AS function_oid,
  t.tgenabled                                      AS enabled_flag
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE p.proname = 'handle_new_user'
  AND NOT t.tgisinternal;

-- -----------------------------------------------------------------------------
-- CHECK 3 — the backfill covered everything and invented nothing.
-- Expect: households_without_signup = 0, and
--         backfilled + live = total_signup_events.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM households)                                     AS households,
  (SELECT count(*) FROM events WHERE event_type = 'signup')             AS total_signup_events,
  (SELECT count(*) FROM events
     WHERE event_type = 'signup'
       AND metadata->>'backfilled' = 'true')                            AS backfilled,
  (SELECT count(*) FROM events
     WHERE event_type = 'signup'
       AND COALESCE(metadata->>'backfilled', 'false') <> 'true')        AS live,
  (SELECT count(*) FROM households h
    WHERE NOT EXISTS (
      SELECT 1 FROM events e
       WHERE e.household_id = h.id AND e.event_type = 'signup'))        AS households_without_signup;

-- -----------------------------------------------------------------------------
-- CHECK 4 — OPTIONAL live probe. Proves the trigger FIRES and writes a row,
-- rather than proving the text is present. Wrapped in an explicit ROLLBACK;
-- nothing survives it.
--
-- This may fail with a NOT NULL violation on some auth.users column depending
-- on the GoTrue version — that is the PROBE's limitation, not a failure of the
-- migration. CHECK 1 is the authoritative one. If it errors, ROLLBACK and move
-- on; do not "fix" it by filling in auth columns you do not understand.
--
  BEGIN;
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      gen_random_uuid(),
      'verify-probe-' || gen_random_uuid() || '@example.invalid',
      jsonb_build_object('full_name', 'Probe', 'locale', 'fr')
    );

    -- Expect exactly: signup_rows = 1, and locale = 'fr' — the locale is the
    -- point, it proves metadata is composed from raw_user_meta_data rather
    -- than hardcoded to the 'en' default.
    SELECT count(*) AS signup_rows,
           max(metadata->>'locale') AS locale
      FROM events e
      JOIN households h ON h.id = e.household_id
     WHERE e.event_type = 'signup'
       AND h.name = 'Probe';
  ROLLBACK;
-- =============================================================================
