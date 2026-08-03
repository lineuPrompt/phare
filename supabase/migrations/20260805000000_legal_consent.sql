-- =============================================================================
-- Phare — recorded consent to the Terms and Privacy Policy. 2026-08-03.
--
-- STATUS: APPLIED — verified live in production on 2026-08-03.
--   Evidence: `SELECT email, terms_accepted_at, terms_version FROM users`
--   returned both household members with BOTH columns reading NULL. The query
--   succeeding proves the columns exist; the NULLs prove no backfill happened,
--   which is the property that matters most here — a non-NULL value would be a
--   consent nobody gave, worse than no record at all.
--
--   Not separately confirmed: the exact column types and
--   idx_users_terms_unaccepted. Neither is load-bearing at two rows; the index
--   is a read optimisation for the guard's lookup, not a correctness guarantee.
--   Re-check with the VERIFY block below if the trial grows.
--
--   Superseded banner, kept as history — until 2026-08-03 this file read:
--     "PENDING APPLICATION — do not apply to production without founder
--      sign-off."
--
-- DEPLOYMENT ORDER IS NOT OPTIONAL: this migration must precede the code.
-- /api/me selects terms_accepted_at and terms_version, so deploying first would
-- 500 the endpoint most of the app calls on mount. Migration first, deploy
-- second — which is the order actually used.
--
-- Two columns on users, written by POST /api/legal/accept.
--
-- WHY NOT raw_user_meta_data. Supabase lets a signed-in user update their own
-- auth metadata from the client. Consent stored there is therefore something
-- the consenting party can rewrite at will, which is the one property a record
-- of consent must not have. These columns are writable only by the service-role
-- client inside the accept route.
--
-- WHY NOT handle_new_user. Capturing at signup would mean the signup trigger
-- reading metadata and writing these columns. That trigger is SECURITY DEFINER,
-- load-bearing, and creates the household + chequing account atomically; an
-- additive change there buys nothing the route does not already give us, and
-- costs a full Path A / Path B regression check. Founder-decided: route only.
--
-- WHY A VERSION COLUMN. "Accepted the terms" is unprovable the moment the
-- documents change. terms_version records WHICH text was accepted, so a later
-- revision can be detected and re-consent required. The current value lives in
-- src/lib/legalVersions.ts — deliberately in code, not here, so publishing a
-- revision is a deploy rather than a migration.
--
-- BOTH NULLABLE, and that is the point: every user who existed before this
-- migration reads NULL, which is the honest state ("has not consented"). The
-- guard treats NULL as unaccepted and routes them to the consent screen on next
-- login. No backfill — a backfill would be inventing a consent that never
-- happened.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version     text;

-- Partial index: the guard's question is "who has NOT accepted the current
-- version?", and unaccepted rows are the rare case once the trial is running.
CREATE INDEX IF NOT EXISTS idx_users_terms_unaccepted
  ON users (id)
  WHERE terms_accepted_at IS NULL;

-- =============================================================================
-- VERIFY (run after applying):
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name IN ('terms_accepted_at', 'terms_version')
--    ORDER BY column_name;          -- expect 2 rows, both is_nullable = YES
--
--   -- Who still needs to consent (expect every pre-existing user):
--   SELECT id, email, terms_accepted_at, terms_version FROM users
--    ORDER BY terms_accepted_at NULLS FIRST;
-- =============================================================================
