-- =============================================================================
-- Phare — the household's reviews must survive the member who generated them
-- Prerequisite for "delete my account", 2026-07-30.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
--
-- THE PROBLEM
-- -----------
-- conversations.user_id is `NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
-- and users.id cascades from auth.users. So deleting ONE member's auth row
-- deletes every conversation row that member happened to trigger.
--
-- That would be defensible if conversations were personal content. They are
-- not. Checked against live data before writing this:
--
--   - 22 rows: 1 `onboarding`, 21 `monthly_review`, 0 `chat`.
--   - EVERY row is roles ["assistant","assistant"] — top_recommendation and
--     monthly_review text. There is not one user-authored message anywhere.
--   - No code in src/ writes type='chat'. (The `role:'user'` occurrences in
--     the codebase are Anthropic API request payloads, not stored rows.)
--   - The dashboard reads them scoped by household_id ONLY, with no user_id
--     filter (src/app/api/dashboard/route.ts) — this is household content
--     shown to every member.
--   - user_id is written on insert and read by nothing.
--
-- So user_id records WHO TRIGGERED GENERATION, not authorship. Under CASCADE,
-- the member who last hit "regenerate plan" deleting their account would wipe
-- the family's entire review history from everyone's dashboard — the same
-- class of bug as file_imports.uploaded_by
-- (20260802000000_file_import_provenance_survives_user_deletion.sql).
--
-- THE CHANGE
-- ----------
--   1. user_id becomes nullable — "the triggering account is gone" has to be
--      representable before SET NULL can mean anything.
--   2. The FK is re-created as ON DELETE SET NULL.
--
-- STILL PURGED, just not by this FK: a WHOLE-HOUSEHOLD deletion removes every
-- conversation via conversations.household_id -> households ON DELETE CASCADE,
-- which is untouched here.
--
-- OBLIGATION ON THE DELETION FUNCTION (step 3, not yet written):
-- member self-deletion MUST still explicitly purge that member's
-- `type = 'chat'` rows. Those would be genuine first-person content and are
-- exactly what erasure means. That DELETE removes zero rows today — no chat
-- feature exists — and it is written ahead of the feature deliberately, so
-- the privacy rule lands before the data does rather than after.
--
-- APP CODE: no change needed. user_id is written on insert
-- (regenerate-plan/route.ts, save-plan/route.ts, always a real user id) and
-- read by nothing — grepped before writing this. Widening the column to
-- nullable cannot break an existing read path.
--
-- The constraint is dropped by lookup rather than by hardcoded name, for the
-- same reason as the uploaded_by migration: a migration that fails on a name
-- mismatch is worse than one that finds the name.
-- =============================================================================

-- 1. Allow "the account that generated this is gone".
ALTER TABLE conversations ALTER COLUMN user_id DROP NOT NULL;

-- 2. Swap CASCADE for SET NULL on the user_id foreign key.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
    INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace   ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND rel.relname = 'conversations'
     AND con.contype = 'f'
     AND con.conkey = ARRAY[
           (SELECT attnum FROM pg_attribute
             WHERE attrelid = rel.oid AND attname = 'user_id')
         ]::smallint[];

  IF v_constraint_name IS NULL THEN
    RAISE NOTICE 'No FK found on conversations.user_id — nothing to drop (already migrated?)';
  ELSE
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK %', v_constraint_name;
  END IF;
END $$;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- =============================================================================
-- VERIFY (run after applying — expect delete_rule = 'SET NULL',
-- is_nullable = 'YES', and every count below unchanged):
--
--   SELECT c.column_name, c.is_nullable, rc.delete_rule, tc.constraint_name
--     FROM information_schema.columns c
--     JOIN information_schema.key_column_usage kcu
--       ON kcu.table_name = c.table_name AND kcu.column_name = c.column_name
--     JOIN information_schema.table_constraints tc
--       ON tc.constraint_name = kcu.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
--     JOIN information_schema.referential_constraints rc
--       ON rc.constraint_name = tc.constraint_name
--    WHERE c.table_name = 'conversations' AND c.column_name = 'user_id';
--
--   SELECT count(*) FROM conversations;                                -- expect 22
--   SELECT count(*) FROM conversations WHERE user_id IS NOT NULL;      -- expect 22
--   SELECT type, count(*) FROM conversations GROUP BY type ORDER BY type;
--     -- expect  monthly_review 21,  onboarding 1   (chat: no rows)
--
-- The household_id CASCADE is deliberately untouched — confirm it still reads
-- CASCADE, since whole-household deletion depends on it:
--
--   SELECT tc.constraint_name, rc.delete_rule
--     FROM information_schema.table_constraints tc
--     JOIN information_schema.referential_constraints rc
--       ON rc.constraint_name = tc.constraint_name
--     JOIN information_schema.key_column_usage kcu
--       ON kcu.constraint_name = tc.constraint_name
--    WHERE tc.table_name = 'conversations' AND kcu.column_name = 'household_id';
--     -- expect CASCADE
-- =============================================================================
