import { createAdminClient } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// THE ONE CLIENT THAT WRITES `categories` (launch plan 1.6, 2026-10-21).
//
// Members could insert, rename and delete their household's categories
// directly over PostgREST: a free household could add custom categories past
// the Pro gate, and a delete cascades into budgets and card-envelope items —
// closed cycles included — and clears the category from past transactions.
// The fix:
//   1. the two writers go through the service role, here —
//      POST /api/categories (after its Pro gate) and /api/save-plan's seed of
//      the fixed set;
//   2. then a migration leaves members SELECT only.
// Step 1 must be deployed before step 2. Reads stay on the member's session.
//
// The service role bypasses RLS, so every write through this client MUST set
// the caller's household_id itself. Both writers do.
//
// TESTS: vitest.setup.ts replaces this with a double that forwards to the
// test's own supabase-server mock and records each table it was asked for
// (src/test/categoriesWriterDouble.ts), so a route that slips back to the
// session client fails its test.
// ---------------------------------------------------------------------------

export async function categoriesWriter() {
  return createAdminClient();
}
