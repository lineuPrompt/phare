-- =============================================================================
-- Phare — restore the 'signup' event to handle_new_user
-- 2026-09-04.
--
-- STATUS: APPLIED AND VERIFIED LIVE on 2026-09-04. All four checks run in the
--   SQL Editor and reported by the founder:
--
--     CHECK 1 (prosrc) — has_events_insert, has_signup_literal,
--       has_empty_string_guard, has_path_b, is_security_definer all TRUE;
--       overload_count = 1. The insert is in the live body, and this replace
--       did not regress 20260623000001's empty-string guard.
--     CHECK 2 (trigger) — on_auth_user_created, on auth.users, bound to this
--       function's oid, tgenabled = 'O'. The function is not merely correct,
--       something calls it.
--     CHECK 3 (backfill) — households = 6, total_signup_events = 6,
--       backfilled = 6, live = 0, households_without_signup = 0.
--     CHECK 4 (live probe) — signup_rows = 1 and locale = 'fr'. Rolled back.
--
--   CHECK 4 IS THE ONE THAT MATTERS MOST. Checks 1-3 confirm text and rows;
--   only this one proves the trigger FIRES, that metadata is composed from
--   raw_user_meta_data rather than hardcoded to the 'en' default, and that the
--   SECURITY DEFINER insert clears the events_all RLS policy. It had never
--   been executed before this date.
--
--   `live = 0` IS ITSELF A FINDING, and the reason this file exists. Not one
--   of the six households had a genuine trigger-written signup row — the
--   regression below covered every household in the database, which is what
--   the diagnosis predicted and had no way to prove until this ran. The first
--   non-backfilled 'signup' row will come from the next real signup.
--   See "READING THE DATA" at the foot of this file: that boundary has to be
--   respected by any funnel query, or the first one you write will lie.
--
--   Superseded banner, kept as history — until 2026-09-04 this file read:
--     "PENDING APPLICATION as of writing. Apply in the SQL Editor, then run
--      the VERIFY block at the bottom and record the result in this banner."
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
-- ALREADY RUN — 2026-09-04, returned signup_rows = 1, locale = 'fr'. See the
-- STATUS banner. It is COMMENTED OUT AGAIN ON PURPOSE and must stay that way.
--
-- WHY IT MUST NOT SIT HERE AS LIVE SQL. It was uncommented to run it, which is
-- exactly right for a one-off probe and exactly wrong to leave behind. Two
-- distinct hazards, the second much worse than the first:
--
--   1. A replay of this file top-to-bottom inserts a junk row into auth.users.
--      Survivable — the ROLLBACK catches it when the block runs standalone.
--
--   2. THE ONE THAT MATTERS: if this file is ever applied by a runner that
--      wraps each migration in its own transaction, the `BEGIN` below is a
--      NO-OP — Postgres warns "there is already a transaction in progress" and
--      carries on — so the trailing `ROLLBACK` is no longer scoped to the
--      probe. It rolls back THE WHOLE FILE: the restored function, the
--      backfill, everything. And the runner, having seen no error, may record
--      the migration as applied.
--
-- That is the same failure shape this migration exists to repair: it succeeds
-- silently and undoes the thing it was supposed to do. To re-run the probe,
-- uncomment it, run it ALONE in the SQL Editor, and re-comment it afterwards.
--
--   BEGIN;
--     INSERT INTO auth.users (id, email, raw_user_meta_data)
--     VALUES (
--       gen_random_uuid(),
--       'verify-probe-' || gen_random_uuid() || '@example.invalid',
--       jsonb_build_object('full_name', 'Probe', 'locale', 'fr')
--     );
--
--     -- Expect exactly: signup_rows = 1, and locale = 'fr' — the locale is the
--     -- point, it proves metadata is composed from raw_user_meta_data rather
--     -- than hardcoded to the 'en' default.
--     SELECT count(*) AS signup_rows,
--            max(metadata->>'locale') AS locale
--       FROM events e
--       JOIN households h ON h.id = e.household_id
--      WHERE e.event_type = 'signup'
--        AND h.name = 'Probe';
--   ROLLBACK;
--
-- After running CHECK 4, confirm the ROLLBACK actually took — the SQL Editor
-- does not always say. Both of these must return zero rows:
--
--   SELECT id, name FROM households WHERE name = 'Probe';
--   SELECT id, email FROM auth.users
--    WHERE email LIKE 'verify-probe-%@example.invalid';
-- =============================================================================


-- =============================================================================
-- READING THE DATA — the cohort boundary this migration creates
--
-- CHECK 3 returned backfilled = 6, live = 0. Every household that existed on
-- 2026-09-04 has a signup row that was RECONSTRUCTED, and none of them has any
-- of the funnel events that shipped the same day (onboarding_entry_viewed,
-- onboarding_path_chosen — src/lib/clientEvents.ts).
--
-- THE TRAP: the obvious first query is "of all households with a signup, how
-- many reached the upload entry screen?" — and today that returns 0 of 6. That
-- number means the events did not exist while those households were onboarding.
-- It does NOT mean nobody reached the page. Reading it as a 0% entry rate would
-- invent a catastrophe out of the fix for the thing being measured, which is a
-- worse outcome than the blindness this all started as.
--
-- So every funnel query must be scoped to households whose signup is LIVE, not
-- backfilled. That predicate is the cohort definition, not a detail:
--
--   WITH cohort AS (
--     SELECT household_id, created_at AS signed_up_at
--       FROM events
--      WHERE event_type = 'signup'
--        AND COALESCE(metadata->>'backfilled', 'false') <> 'true'
--   )
--   SELECT
--     count(*)                                                   AS signups,
--     count(*) FILTER (WHERE reached_entry)                      AS reached_entry,
--     count(*) FILTER (WHERE chose_template)                     AS chose_template,
--     count(*) FILTER (WHERE chose_manual)                       AS chose_manual,
--     count(*) FILTER (WHERE generated_plan)                     AS generated_plan,
--     count(*) FILTER (WHERE saved_plan)                         AS saved_plan,
--     count(*) FILTER (WHERE active_days > 1)                    AS came_back
--   FROM (
--     SELECT
--       c.household_id,
--       EXISTS (SELECT 1 FROM events e WHERE e.household_id = c.household_id
--                AND e.event_type = 'onboarding_entry_viewed')     AS reached_entry,
--       EXISTS (SELECT 1 FROM events e WHERE e.household_id = c.household_id
--                AND e.event_type = 'onboarding_path_chosen'
--                AND e.metadata->>'path' = 'template')             AS chose_template,
--       EXISTS (SELECT 1 FROM events e WHERE e.household_id = c.household_id
--                AND e.event_type = 'onboarding_path_chosen'
--                AND e.metadata->>'path' = 'manual')               AS chose_manual,
--       EXISTS (SELECT 1 FROM events e WHERE e.household_id = c.household_id
--                AND e.event_type = 'onboarding_plan_generated')   AS generated_plan,
--       EXISTS (SELECT 1 FROM events e WHERE e.household_id = c.household_id
--                AND e.event_type = 'completed_onboarding')        AS saved_plan,
--       (SELECT count(*) FROM events e WHERE e.household_id = c.household_id
--                AND e.event_type = 'returned')                    AS active_days
--     FROM cohort c
--   ) f;
--
-- TWO THINGS THAT WILL BE MISREAD IF NOT WRITTEN DOWN:
--
--   'returned' IS AN ACTIVE-DAY COUNT, NOT A RETURN COUNT. It is deduped per
--   (household, user, UTC day) and fires on the FIRST dashboard load ever, so
--   "came back" is count > 1, never count > 0. It is also UTC rather than the
--   household's timezone, so a late-evening Montréal session can straddle two
--   UTC days and read as two.
--
--   chose_template AND chose_manual ARE NOT MUTUALLY EXCLUSIVE, deliberately.
--   Someone who drops the wrong file and then falls back to typing sets both,
--   and that pair is a real finding about the template rather than a bug in the
--   query. They also both fire on the ATTEMPT, before /api/upload can refuse
--   the file — the refusal reason is onboarding_upload_rejected, which is not
--   built yet.
-- =============================================================================
