-- Give back 2be22642's three November refreshes spent on Regenerates that
-- saved no letter (2 November 2026: 16:25, 20:38, 20:39 UTC — the letter
-- guards refused all three; no 2026-11 letter exists for the household).
-- From now on the route gives a failed refresh back itself.
-- Run in the Supabase SQL Editor. Scoped to the household and to these three ids.

-- BEFORE (expected: 3 rows)
SELECT id, created_at, metadata
  FROM events
 WHERE household_id = (SELECT id FROM households WHERE id::text LIKE '2be22642%')
   AND event_type = 'review_regenerated'
   AND id IN ('f509299a-67d1-41f8-bed0-85d4cb5f404d', '88572f24-c01f-4dcc-9cba-b9faa4e25b0d', 'db14ab9e-9d09-4518-a3f8-41d305c0724f');

BEGIN;

-- Expected: 3 rows deleted.
DELETE FROM events
 WHERE household_id = (SELECT id FROM households WHERE id::text LIKE '2be22642%')
   AND event_type = 'review_regenerated'
   AND id IN ('f509299a-67d1-41f8-bed0-85d4cb5f404d', '88572f24-c01f-4dcc-9cba-b9faa4e25b0d', 'db14ab9e-9d09-4518-a3f8-41d305c0724f');

COMMIT;

-- VERIFY (expected: 0 — all four November refreshes available again)
SELECT count(*) AS november_refreshes_used
  FROM events
 WHERE household_id = (SELECT id FROM households WHERE id::text LIKE '2be22642%')
   AND event_type = 'review_regenerated'
   AND metadata->>'month' = '2026-11';
