-- =============================================================================
-- Phare — account deletion, BOTH cases. 2026-08-03.
--
-- STATUS: APPLIED — schema verified live in production on 2026-08-03 by direct
--   inspection (information_schema / pg_catalog), not by assumption. All nine
--   checks passed:
--     household_members.deleted_at present and nullable; the
--     idx_household_members_live and idx_member_deletion_requests_unfinished
--     partial indexes present; member_deletion_requests present with RLS
--     enabled and its household-scoped policy attached; kind column present
--     defaulting to 'member'; subject_user_id carries NO foreign key (the audit
--     trail cannot self-destruct); all three functions present with exactly one
--     overload each.
--
--   SCOPE OF THAT VERIFICATION — read this before trusting it. It confirms the
--   SCHEMA is in place. It does NOT confirm the procedural code runs:
--   delete_household_member() and delete_household() were verified to EXIST,
--   not to EXECUTE. Their guards (PH404/PH409/PH412/PH425), the type='chat'
--   purge, the users.household_id access revocation and the household cascade
--   have never run against real data as of this line. The route tests that
--   cover them are mocked and prove nothing about any of it. First real
--   execution is the founder's end-to-end deletion pass on a throwaway
--   household; update this note once that has happened.
--
--   Superseded banner, kept as history — until 2026-08-03 this file read:
--     "PENDING APPLICATION — do not apply to production without founder
--      sign-off."
--
-- FILENAME NOTE: this file is still named ..._member_self_deletion.sql because
-- it was already circulating under that name when Case A (step 4) was added to
-- it. It has NOT been renamed on purpose — renaming an unapplied migration that
-- someone is about to paste into a SQL editor is a good way to get a stale copy
-- applied. It now covers both cases; the name undersells it.
--
-- Steps 3 and 4 of the deletion work. The two cases stay conceptually distinct
-- even though they now share this file, a marker table, and a preview function:
--   Case A — WHOLE-HOUSEHOLD deletion. The household and everything in it is
--            destroyed. Reached three ways: a sole-member household deleting
--            their account, an owner deleting the household outright, and the
--            all-pending escape hatch below.
--   Case B — ONE member leaves, the household SURVIVES.
--
-- WHAT CASE B MEANS, precisely:
--   - IDENTITY is erased: the auth.users row is hard-deleted, which cascades
--     public.users, which SET NULLs household_members.user_id,
--     file_imports.uploaded_by and conversations.user_id (the two "survives
--     deletion" migrations exist exactly so that cascade detaches instead of
--     destroying household data).
--   - The household_members ROW IS KEPT and relabelled. It is not optional:
--     transactions.member_id is `NOT NULL REFERENCES household_members(id)`
--     with NO ON DELETE clause — i.e. NO ACTION — so deleting the row would
--     fail outright against any household with a single attributed
--     transaction. Keeping it is also the honest answer: the money movements
--     really happened and really belonged to someone.
--   - The LEDGER IS UNTOUCHED. No transaction is deleted, relabelled,
--     reassigned, or re-attributed. Unlike delete_goal_account and
--     delete_sinking_fund_buffer, this function does not write to
--     `transactions` at all — grep it and confirm.
--
-- WHY A MARKER TABLE (the "record of intent"):
--   Deletion is two systems: Postgres and Supabase Auth. They cannot share a
--   transaction. Whichever runs second can fail, leaving a half-deleted
--   person that NOBODY CAN SEE. member_deletion_requests is written BEFORE
--   either step, so a half-finished deletion is discoverable by query rather
--   than by a support ticket. The DB step stamps db_completed_at; the auth
--   step stamps auth_completed_at. Any row with auth_completed_at IS NULL and
--   a requested_at older than a few minutes is a deletion that needs
--   finishing — see the OPS QUERY at the bottom of this file.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tombstone flag on household_members.
--
-- This is the pin for the RE-INVITE-MUST-NOT-REATTACH rule, and it is the
-- subtlest part of Case B.
--
-- After deletion the member row has user_id = NULL — which makes it, to every
-- existing query, indistinguishable from a name-only row created by onboarding
-- discovery or quick-add. POST /api/household/members runs match-before-create
-- against exactly those rows (findMemberNameCandidates over
-- `household_members WHERE user_id IS NULL`) and ATTACHES a new invite to a
-- name match instead of creating a new person.
--
-- So without this flag, re-inviting someone with the same name would silently
-- reattach a live account to the erased person's row — resurrecting the exact
-- identity link the deletion was performed to destroy, and handing the new
-- account the old person's entire attribution history. deleted_at makes the
-- tombstone visible so the matcher can exclude it.
--
-- Nullable timestamptz rather than a boolean: "when" is free and answers the
-- support question the boolean cannot.
-- -----------------------------------------------------------------------------
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Partial index — every candidate-matching query filters on deleted_at IS NULL,
-- and live rows are the overwhelming majority.
CREATE INDEX IF NOT EXISTS idx_household_members_live
  ON household_members (household_id)
  WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- 2. The record of intent.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_deletion_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- household_id CASCADES, deliberately, and that has a consequence worth
  -- stating plainly because it drives the ordering of Case A below.
  --
  -- Cascading is required: this table holds subject_email, so a whole-household
  -- deletion must reach it or Case A leaves orphaned personal data behind (the
  -- cascadeInvariants enumeration exists to enforce exactly that).
  --
  -- But it means a Case A marker row is DESTROYED BY THE OPERATION IT
  -- DESCRIBES. So Case A cannot be ordered like Case B. delete_household()
  -- runs the auth deletions FIRST and drops the household row LAST, which
  -- makes the row's own lifetime the progress signal:
  --     row still present  → work outstanding (read auth_completed_at)
  --     row gone           → the household delete committed; nothing to finish
  -- Inverting that (household first) would be simpler and would silently make
  -- every failed Case A undiscoverable.
  household_id      uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  -- Which case this row describes. 'member' rows carry a member_id; 'household'
  -- rows do not (there is no single member being removed).
  kind              text        NOT NULL DEFAULT 'member'
                                CHECK (kind IN ('member', 'household')),

  member_id         uuid                 REFERENCES household_members(id) ON DELETE SET NULL,

  -- DELIBERATELY NOT A FOREIGN KEY.
  --
  -- users.id and auth.users.id are precisely what this process destroys. An FK
  -- here would cascade (or block) at the exact moment the record becomes
  -- valuable: a successful auth deletion would delete its own audit trail, and
  -- the half-finished case — the one this table exists to make discoverable —
  -- would be the only one that left a row. A plain uuid keeps the record
  -- truthful after its subject is gone.
  -- kind='member'    → the departing member.
  -- kind='household' → whoever INITIATED the household deletion. Every member's
  --                    auth row is erased in that case, so this identifies the
  --                    person who authorized it, not the only person affected.
  subject_user_id   uuid        NOT NULL,
  -- Denormalized before deletion for the same reason: after the auth row is
  -- gone there is no way to answer "who was this?" for support or for a
  -- regulator asking us to evidence an erasure.
  subject_email     text,

  requested_at      timestamptz NOT NULL DEFAULT now(),
  db_completed_at   timestamptz,
  auth_completed_at timestamptz,
  -- Last failure from the auth step, so a retry starts informed.
  last_error        text,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_deletion_requests_household
  ON member_deletion_requests (household_id);

-- The ops index: find unfinished deletions cheaply.
CREATE INDEX IF NOT EXISTS idx_member_deletion_requests_unfinished
  ON member_deletion_requests (requested_at)
  WHERE auth_completed_at IS NULL;

ALTER TABLE member_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Household-scoped, same shape as every other policy in this schema. Note the
-- subject themself can never read this: by the time a row matters their users
-- row is gone, so auth.uid() resolves to no household. That is correct — this
-- is the household's and the operator's record, not the departed member's.
-- Dropped first so this whole file is safely RE-RUNNABLE. Every other statement
-- here is already idempotent (IF NOT EXISTS / CREATE OR REPLACE), but a bare
-- CREATE POLICY errors with "policy already exists" — which would make a retry
-- after any partial failure fail on a line that is not the real problem.
DROP POLICY IF EXISTS "member_deletion_requests_household_all" ON member_deletion_requests;

CREATE POLICY "member_deletion_requests_household_all" ON member_deletion_requests
  FOR ALL USING (
    household_id = (SELECT household_id FROM public.users WHERE id = auth.uid())
  );


-- -----------------------------------------------------------------------------
-- 3. The DB half of the deletion — one function, therefore one transaction.
--
-- SECURITY INVOKER, and intended to be called with the SERVICE-ROLE client
-- from a route that has ALREADY authenticated the caller and confirmed the
-- caller IS the subject. That combination is deliberate:
--
--   - Not SECURITY DEFINER: this function revokes access and touches multiple
--     tables; giving it definer rights would add a privilege-escalation
--     surface for no benefit the service-role client doesn't already provide.
--   - Not called with the user's own client either: step 5 below NULLs
--     users.household_id, and almost every RLS policy in this schema resolves
--     the tenant through `(SELECT household_id FROM public.users WHERE id =
--     auth.uid())`. Under the caller's own client the function would revoke
--     its own visibility partway through and the remaining statements would
--     silently match zero rows. Ordering could dodge that today, but it would
--     be a landmine for the next person to edit this body.
--
-- The p_household_id checks below are therefore the real tenant guard, not a
-- formality — they are what stops a mis-wired caller deleting across
-- households.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_household_member(
  p_household_id uuid,
  p_member_id    uuid,
  p_user_id      uuid,
  p_request_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_member_exists    boolean;
  v_access_holders   int;
  v_owner_count      int;
  v_subject_is_owner boolean;
  v_purged_chats     int;
  v_old_name         text;
BEGIN
  -- ---------------------------------------------------------------------
  -- Guards. These raise rather than return a soft failure: a partially
  -- applied Case B is worse than a refused one.
  -- ---------------------------------------------------------------------

  -- Tenant check: the member row must belong to the stated household, and
  -- must currently be attached to the stated user.
  SELECT true, name INTO v_member_exists, v_old_name
    FROM household_members
   WHERE id = p_member_id
     AND household_id = p_household_id
     AND user_id = p_user_id
     AND deleted_at IS NULL;

  IF NOT COALESCE(v_member_exists, false) THEN
    RAISE EXCEPTION 'Member % not found in household % for user % (or already deleted)',
      p_member_id, p_household_id, p_user_id
      USING ERRCODE = 'PH404';
  END IF;

  -- Case A boundary. If this is the last member who can sign in, deleting
  -- them does not leave a household — it leaves an orphan nobody can reach,
  -- with a live ledger and no way in. That is whole-household deletion, a
  -- different feature with different consent. Refuse rather than approximate.
  SELECT count(*) INTO v_access_holders
    FROM household_members
   WHERE household_id = p_household_id
     AND user_id IS NOT NULL
     AND deleted_at IS NULL;

  IF v_access_holders <= 1 THEN
    RAISE EXCEPTION 'Refusing: % is the last member with account access in household % — that is whole-household deletion (Case A), not member self-deletion (Case B)',
      p_member_id, p_household_id
      USING ERRCODE = 'PH409';
  END IF;

  -- Sole-owner boundary. A household with members but no owner cannot invite,
  -- promote, or remove anyone — every one of those routes is owner-gated. The
  -- owner must hand off first (POST /api/household/members/[id]/promote).
  SELECT (role = 'owner') INTO v_subject_is_owner
    FROM users WHERE id = p_user_id;

  SELECT count(*) INTO v_owner_count
    FROM users
   WHERE household_id = p_household_id
     AND role = 'owner';

  IF COALESCE(v_subject_is_owner, false) AND v_owner_count <= 1 THEN
    RAISE EXCEPTION 'Refusing: user % is the only owner of household % — transfer ownership before deleting this account',
      p_user_id, p_household_id
      USING ERRCODE = 'PH412';
  END IF;

  -- ---------------------------------------------------------------------
  -- 4. Erase the identity link, keep the person-shaped row.
  --
  -- user_id is NULLed HERE rather than left to the auth cascade. If the auth
  -- step later fails, the household must already be in a consistent state:
  -- the cap slot freed, the row tombstoned, no dangling link. Doing it here
  -- also makes the whole DB half idempotent-by-guard (the deleted_at IS NULL
  -- check above refuses a second run).
  --
  -- The stored name is a neutral placeholder, NOT a display string: the
  -- household page must render a translated label off the tombstone flag, not
  -- echo this text (see the UI follow-up noted in the handoff — deliberately
  -- not built here).
  -- ---------------------------------------------------------------------
  UPDATE household_members
     SET user_id    = NULL,
         name       = 'Former member',
         deleted_at = now(),
         updated_at = now()
   WHERE id = p_member_id
     AND household_id = p_household_id;

  -- ---------------------------------------------------------------------
  -- 5. DISCHARGE the obligation recorded in
  -- 20260803000000_conversations_survive_member_deletion.sql.
  --
  -- That migration made conversations.user_id ON DELETE SET NULL so the
  -- household's reviews survive a member leaving — and explicitly wrote down
  -- that member deletion must STILL purge that member's own type='chat' rows,
  -- because those would be genuine first-person content and erasure means
  -- erasing them.
  --
  -- This DELETE removes zero rows today: no chat feature exists, and no code
  -- in src/ writes type='chat'. It is written ahead of the feature on purpose,
  -- so the privacy rule lands before the data does rather than after.
  --
  -- Scoped by household_id as well as user_id — the service-role client has no
  -- RLS to fall back on, so tenant scoping is this statement's own job.
  -- ---------------------------------------------------------------------
  DELETE FROM conversations
   WHERE household_id = p_household_id
     AND user_id = p_user_id
     AND type = 'chat';
  GET DIAGNOSTICS v_purged_chats = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- 6. Revoke application access inside this transaction.
  --
  -- This is the real answer to the stale-JWT window. Supabase access tokens
  -- are stateless and stay signature-valid until they expire (~1h), so neither
  -- deleting the auth user nor a global sign-out can retract one already in a
  -- browser. But EVERY authenticated route in this app resolves the caller's
  -- tenant through users.household_id (getCallerInfo, and the identical
  -- household lookup each route does), and every RLS policy resolves it the
  -- same way. NULLing it here means a surviving token authenticates as a user
  -- with no household: getCallerInfo returns null → 401, and RLS matches zero
  -- rows.
  --
  -- So access dies at commit time, not at token expiry, and not contingent on
  -- the auth step succeeding at all. The global sign-out in the route is
  -- defence in depth on top of this, not the mechanism.
  --
  -- The users row itself is deliberately left for the auth cascade to remove.
  -- Deleting it here would strand a live auth.users row with no profile — a
  -- state no other code path expects — and would make the auth step's retry
  -- semantics murkier for no gain.
  -- ---------------------------------------------------------------------
  UPDATE users
     SET household_id = NULL,
         updated_at   = now()
   WHERE id = p_user_id;

  -- ---------------------------------------------------------------------
  -- 7. Stamp the marker: DB half done, auth half outstanding.
  -- ---------------------------------------------------------------------
  UPDATE member_deletion_requests
     SET db_completed_at = now()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'memberId',        p_member_id,
    'previousName',    v_old_name,
    'purgedChatRows',  v_purged_chats,
    'accessRevoked',   true,
    'requestId',       p_request_id
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Blast radius, read from the database.
--
-- Feeds the confirmation screen for BOTH cases. It exists as a function rather
-- than a handful of route-level counts so the numbers a family is shown before
-- destroying their data come from one place and cannot drift apart.
--
-- Read-only. STABLE so the planner may fold it; never mutates anything.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION household_deletion_preview(p_household_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'householdName',  (SELECT name FROM households WHERE id = p_household_id),
    -- Live people, not tombstones: a former member is already erased and must
    -- not be counted as something still to lose.
    'members',        (SELECT count(*) FROM household_members
                        WHERE household_id = p_household_id AND deleted_at IS NULL),
    'accounts',       (SELECT count(*) FROM accounts        WHERE household_id = p_household_id),
    'transactions',   (SELECT count(*) FROM transactions    WHERE household_id = p_household_id),
    'recurringItems', (SELECT count(*) FROM recurring_items WHERE household_id = p_household_id),
    'sinkingFunds',   (SELECT count(*) FROM sinking_funds   WHERE household_id = p_household_id),
    'reviews',        (SELECT count(*) FROM conversations   WHERE household_id = p_household_id),
    -- How much history is at stake, in the unit a family actually feels.
    'monthsOfHistory',(SELECT COALESCE(
                          count(DISTINCT date_trunc('month', date))::int, 0)
                         FROM transactions WHERE household_id = p_household_id),
    'earliestDate',   (SELECT min(date) FROM transactions WHERE household_id = p_household_id)
  ) INTO v;
  RETURN v;
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. Case A — whole-household deletion.
--
-- CASCADE VERIFIED EMPIRICALLY against the real production household on
-- 2026-07-30: BEGIN; DELETE FROM households WHERE id = ...; ROLLBACK; — the
-- DELETE completed with no RESTRICT or NO ACTION violation, so every
-- household-scoped table really is reachable by cascade as the schema stands.
-- That is an empirical result about a specific schema on a specific date, not a
-- property that holds forever.
--
-- WHAT WOULD INVALIDATE IT — re-run the BEGIN/DELETE/ROLLBACK probe if either
-- of these lands:
--
--   1. A NEW FOREIGN KEY DECLARED **RESTRICT** into any household-scoped table.
--      This is the sharp edge, and it is worth understanding why the schema
--      survives today: transactions.member_id is `NOT NULL REFERENCES
--      household_members(id)` with NO ON DELETE clause — i.e. NO ACTION — which
--      sounds like it should block the cascade and does not. NO ACTION is
--      checked at END OF STATEMENT, and by then the referencing transactions
--      have themselves been removed by their own household_id cascade, so there
--      is nothing left to violate. RESTRICT is checked IMMEDIATELY and cannot be
--      deferred, so an otherwise identical RESTRICT FK WOULD abort the delete.
--      The difference is invisible in the schema at a glance and total at
--      runtime.
--
--   2. A NEW HOUSEHOLD-SCOPED TABLE whose household_id FK is not ON DELETE
--      CASCADE, or a NO ACTION FK from a table that is NOT itself household-
--      scoped (and so is not deleted by the same cascade — the condition that
--      saves transactions.member_id would not apply to it).
--      src/lib/__tests__/cascadeInvariants.test.ts enumerates the cascading
--      tables and fails when a new one appears, which is the tripwire for this.
--
-- ORDERING: this function is the LAST step of Case A, not the first. Every
-- member's auth identity is erased by the route BEFORE this runs. See the
-- household_id comment on member_deletion_requests for why — dropping the
-- household first would delete the marker row describing the very operation in
-- progress, and a Case A that failed halfway would leave nothing to find.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_household(
  p_household_id uuid,
  p_request_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name           text;
  v_deleted        int;
  v_remaining_auth int;
BEGIN
  SELECT name INTO v_name FROM households WHERE id = p_household_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Household % not found', p_household_id
      USING ERRCODE = 'PH404';
  END IF;

  -- Refuse to drop the household while any member can still sign in. Reaching
  -- here with a live auth user means the route's auth loop did not finish, and
  -- proceeding would strand a login pointing at a household that no longer
  -- exists — signed in, with every query returning nothing and no way to
  -- recover. Better to leave the marker row and stop.
  SELECT count(*) INTO v_remaining_auth
    FROM users WHERE household_id = p_household_id;

  IF v_remaining_auth > 0 THEN
    RAISE EXCEPTION 'Refusing: % account(s) still exist for household % — erase every identity before dropping the household',
      v_remaining_auth, p_household_id
      USING ERRCODE = 'PH425';
  END IF;

  -- The one statement. Everything else goes with it by cascade, including the
  -- member_deletion_requests row identified by p_request_id — which is why
  -- there is nothing to stamp after this and why the caller must treat the
  -- row's DISAPPEARANCE as success.
  DELETE FROM households WHERE id = p_household_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'householdDeleted', v_deleted = 1,
    'householdName',    v_name,
    'requestId',        p_request_id
  );
END;
$$;


-- =============================================================================
-- OPS QUERY — unfinished deletions (the whole point of the marker table).
-- The two kinds read DIFFERENTLY, because their orderings are mirror images:
--
--   kind='member'    — a row with auth_completed_at IS NULL means the DB half
--                      committed but the auth identity still exists. The person
--                      cannot use the app (household_id is NULL) but has not
--                      been erased. Re-run the auth deletion for
--                      subject_user_id.
--
--   kind='household' — the row is deleted by the cascade when the household
--                      finally drops, so ANY surviving row is unfinished work.
--                      auth_completed_at tells you where it stopped:
--                        NULL     → identities still being erased; re-run the
--                                   auth loop for every users row in
--                                   household_id, then delete_household().
--                        NOT NULL → identities gone, household row not dropped.
--                                   Call delete_household() again; it is safe
--                                   to repeat.
--
--   SELECT id, kind, household_id, subject_user_id, subject_email,
--          requested_at, db_completed_at, auth_completed_at, last_error
--     FROM member_deletion_requests
--    WHERE auth_completed_at IS NULL
--       OR kind = 'household'
--    ORDER BY requested_at;
--
-- Narrow to genuinely stuck work (a household deletion in flight is normally
-- visible for well under a second):
--
--   SELECT * FROM member_deletion_requests
--    WHERE requested_at < now() - interval '5 minutes'
--      AND (auth_completed_at IS NULL OR kind = 'household')
--    ORDER BY requested_at;
--
-- VERIFY (run after applying):
--
--   SELECT column_name, is_nullable, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'household_members'
--      AND column_name = 'deleted_at';                    -- expect 1 row, YES
--
--   SELECT to_regclass('public.member_deletion_requests'); -- expect non-NULL
--
--   -- Exactly one overload of EACH, and no leftovers:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('delete_household_member', 'delete_household',
--                        'household_deletion_preview')
--    ORDER BY p.proname;                       -- expect exactly 3 rows
--
--   -- The kind column and its CHECK:
--   SELECT column_name, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'member_deletion_requests'
--      AND column_name = 'kind';
--
--   -- Re-run the cascade probe (see the delete_household header) if any FK has
--   -- changed since 2026-07-30. Rolls back — nothing is destroyed:
--   --   BEGIN;
--   --   DELETE FROM households WHERE id = '<a real household id>';
--   --   ROLLBACK;
--
--   SELECT count(*) AS must_be_zero
--     FROM pg_constraint con
--     JOIN pg_class rel ON rel.oid = con.conrelid
--    WHERE rel.relname = 'member_deletion_requests'
--      AND con.contype = 'f'
--      AND 'subject_user_id' = ANY (
--            SELECT attname FROM pg_attribute
--             WHERE attrelid = rel.oid AND attnum = ANY (con.conkey));
-- =============================================================================
