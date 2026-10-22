import { createAdminClient } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// THE ONE CLIENT THAT WRITES A CARD'S PLAN — `monthly_goals` and
// `card_envelope_items` (launch plan 1.6, 2026-10-22).
//
// The closed-cycle lock (a statement whose close date has passed keeps its
// plan) lives in POST /api/card-envelope. Members could step around it by
// writing both tables directly over PostgREST, rewriting a closed month's
// goal and category budgets after its spending was known. The fix:
//   1. every write of both tables goes through the service role, here — the
//      goal upsert, the month's item replace, and 'apply' removing later
//      months' plans, all in POST /api/card-envelope;
//   2. then a migration leaves members SELECT only.
// Step 1 must be deployed before step 2. Reads stay on the member's session.
//
// The service role bypasses RLS, so every write through this client MUST set
// or filter by the caller's household_id itself, and the route checks each
// category is the household's own before writing.
//
// TESTS: vitest.setup.ts replaces this with a double that forwards to the
// test's own supabase-server mock and records each table it was asked for
// (src/test/cardPlanWriterDouble.ts), so a write that slips back to the
// session client fails its test.
// ---------------------------------------------------------------------------

export async function cardPlanWriter() {
  return createAdminClient();
}
