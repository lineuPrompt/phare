-- =============================================================================
-- Phare — households.timezone: the canonical "what day is it for this family"
-- source of truth.
--
-- PROBLEM: every "today"/"current month" derivation in the app (anchor ≤-today
-- guards, goal/debt balance cutoffs, recurring materialization month-start,
-- the timeline's today-marker/dip) was computed from the server process's
-- local clock — which is UTC in production — or the browser's local clock.
-- Neither is the household's actual calendar day: a household in Montreal
-- (UTC-4/-5) has its server-side "today" roll over to tomorrow several hours
-- before local midnight, so anything computed in the evening silently used
-- the wrong day/month.
--
-- FIX: one column, one meaning. Every date-boundary computation resolves
-- "today" via this timezone (see businessToday()/businessMonth() in
-- dateHelpers.ts), never the server's or browser's raw local clock.
--
-- Additive: NOT NULL DEFAULT backfills every existing household (including
-- production) to 'America/Toronto' — correct for every household today,
-- editable later once Phare expands beyond Quebec/Ontario.
-- =============================================================================

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Toronto';
