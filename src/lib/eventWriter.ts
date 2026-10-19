import { createAdminClient } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// THE ONE CLIENT THAT WRITES `events` (launch plan item 1.1, 2026-10-19).
//
// `events` holds the funnel AND the counters the AI spend limits count
// (onboarding_plan_generated, onboarding_review_generated, review_regenerated).
// Members could write, change and delete those rows through PostgREST with
// their own session (ticket: events-rls-client-writable). The fix:
//   1. every write goes through the service role, here — logEvent, both quota
//      reservations, /api/events;
//   2. then a migration revokes INSERT/UPDATE/DELETE from members, who keep
//      SELECT (the quota counts and "first time" checks read with the
//      member's own session, scoped by RLS).
// Step 1 must be deployed before step 2: until then, member-session inserts
// would simply fail.
//
// Every caller scopes its row by household_id itself: the service role
// bypasses RLS, so the household on the row is the caller's responsibility,
// exactly as in every other admin write.
//
// TESTS: vitest.setup.ts replaces this module suite-wide with a recording
// double (src/test/eventWriterDouble.ts). Read written events from there.
// ---------------------------------------------------------------------------

export function eventWriter() {
  return createAdminClient();
}
