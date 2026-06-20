-- =============================================================================
-- Phare — event log
-- Applied 2026-06-20.
-- Lightweight diary of lifecycle events for the 30-day private trial.
-- Two users. Not an analytics pipeline — a queryable record of when things happened.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type   text        NOT NULL,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Query pattern: "show me all events for household X, by type, newest first"
CREATE INDEX IF NOT EXISTS idx_events_household_type_date
  ON events (household_id, event_type, created_at DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Household members read/write their own events.
-- Inlined directly rather than calling auth_household_id() — makes this
-- migration self-contained regardless of whether that helper exists.
-- The handle_new_user trigger runs SECURITY DEFINER, so it bypasses RLS
-- and can insert the 'signup' event without a special policy.
CREATE POLICY "events_all" ON events
  FOR ALL USING (
    household_id = (SELECT household_id FROM public.users WHERE id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Extend handle_new_user to log the 'signup' event at household creation.
-- Exactly the same body as the original, plus one INSERT at the end.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_household_id uuid;
  member_name      text;
BEGIN
  member_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));

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

  -- Diary: record the moment this household was born.
  INSERT INTO events (household_id, user_id, event_type, metadata)
    VALUES (
      new_household_id,
      NEW.id,
      'signup',
      jsonb_build_object('locale', COALESCE(NEW.raw_user_meta_data->>'locale', 'en'))
    );

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Verification query (run after applying the migration):
--
--   SELECT event_type, count(*) FROM events GROUP BY event_type ORDER BY count DESC;
--
-- After the trial, for retention analysis:
--   SELECT user_id, date_trunc('day', created_at) AS day
--     FROM events WHERE event_type = 'returned'
--    ORDER BY user_id, day;
-- =============================================================================
