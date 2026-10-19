import { createAdminClient } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// THE ONE CLIENT THAT READS OR WRITES `conversations` (launch plan 1.3,
// 2026-10-19).
//
// `conversations` holds the FULL text of every monthly review and onboarding
// letter. The Pro cut-off for free households (reviewForEntitlement) happens
// in the routes, so a member who could SELECT the table directly over
// PostgREST read the whole letter anyway. The fix:
//   1. every read and write goes through the service role, here —
//      /api/reviews, /api/dashboard, /api/regenerate-plan, /api/save-plan
//      (the monthly-review cron already used the admin client);
//   2. then a migration revokes EVERY member privilege on the table, SELECT
//      included. Only the server reads letters, and it truncates before
//      anything leaves.
// Step 1 must be deployed before step 2.
//
// The service role bypasses RLS, so every query through this client MUST
// filter by the caller's household_id itself. Each route already does.
//
// TESTS: vitest.setup.ts replaces this with a double that forwards to the
// test's own supabase-server mock and records each table it was asked for
// (src/test/conversationsClientDouble.ts), so a route that slips back to the
// session client fails its test.
// ---------------------------------------------------------------------------

export async function conversationsClient() {
  return createAdminClient();
}
