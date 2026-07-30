-- =============================================================================
-- Phare — import provenance must survive the person who uploaded the file
-- Prerequisite for "delete my account", 2026-07-30.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
--
-- THE PROBLEM
-- -----------
-- file_imports.uploaded_by is `NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
-- users.id in turn cascades from auth.users. So deleting ONE member's auth row
-- silently deletes every file_imports row that member ever uploaded — and
-- because transactions.file_import_id is ON DELETE SET NULL, the household's
-- transactions quietly lose their provenance link at the same time.
--
-- That is a cross-member side effect nobody asks for: a member deleting their
-- own account destroys a record that belongs to the whole household, and the
-- remaining family never sees it happen. Import provenance is household data,
-- not personal data — it says "these rows came from this spreadsheet", which
-- stays true regardless of who is still a member.
--
-- Live data at the time of writing (checked, not assumed): 1 file_imports row
-- and 24 transactions carrying a file_import_id. Small today, and precisely
-- why this is cheap to fix now rather than after the first real trial import.
--
-- THE CHANGE
-- ----------
--   1. uploaded_by becomes nullable — "the uploader's account is gone" has to
--      be representable before SET NULL can mean anything.
--   2. The FK is re-created as ON DELETE SET NULL, so deleting a user detaches
--      the row instead of destroying it.
--
-- Deliberately NOT relabelled to a placeholder user: NULL is the honest value
-- for "we no longer know who, because they exercised their right to be
-- forgotten". Any future "uploaded by" display must read NULL as unknown.
--
-- APP CODE: no change needed. `uploaded_by` is written on insert
-- (buildFileImportRow in src/lib/importProvenance.ts, always a real user id)
-- and read by nothing — grepped before writing this. Widening the column to
-- nullable therefore cannot break an existing read path.
--
-- The constraint is dropped by lookup rather than by hardcoded name: the
-- default would be file_imports_uploaded_by_fkey, but a constraint created by
-- hand at any point in this project's history could carry another name, and a
-- migration that fails on a name mismatch is worse than one that finds it.
-- =============================================================================

-- 1. Allow "uploader unknown".
ALTER TABLE file_imports ALTER COLUMN uploaded_by DROP NOT NULL;

-- 2. Swap CASCADE for SET NULL on the uploaded_by foreign key.
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
     AND rel.relname = 'file_imports'
     AND con.contype = 'f'
     AND con.conkey = ARRAY[
           (SELECT attnum FROM pg_attribute
             WHERE attrelid = rel.oid AND attname = 'uploaded_by')
         ]::smallint[];

  IF v_constraint_name IS NULL THEN
    RAISE NOTICE 'No FK found on file_imports.uploaded_by — nothing to drop (already migrated?)';
  ELSE
    EXECUTE format('ALTER TABLE file_imports DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK %', v_constraint_name;
  END IF;
END $$;

ALTER TABLE file_imports
  ADD CONSTRAINT file_imports_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

-- =============================================================================
-- VERIFY (run after applying — expect delete_rule = 'SET NULL',
-- is_nullable = 'YES', and the row/transaction counts unchanged):
--
--   SELECT c.column_name, c.is_nullable, rc.delete_rule, tc.constraint_name
--     FROM information_schema.columns c
--     JOIN information_schema.key_column_usage kcu
--       ON kcu.table_name = c.table_name AND kcu.column_name = c.column_name
--     JOIN information_schema.table_constraints tc
--       ON tc.constraint_name = kcu.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
--     JOIN information_schema.referential_constraints rc
--       ON rc.constraint_name = tc.constraint_name
--    WHERE c.table_name = 'file_imports' AND c.column_name = 'uploaded_by';
--
--   SELECT count(*) AS file_imports FROM file_imports;                    -- expect 1
--   SELECT count(*) AS provenanced  FROM transactions
--    WHERE file_import_id IS NOT NULL;                                    -- expect 24
-- =============================================================================
