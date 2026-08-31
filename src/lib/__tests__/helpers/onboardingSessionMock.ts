// ---------------------------------------------------------------------------
// A signed-in household with room on its onboarding allowance.
//
// TEST-ONLY. Never imported by application code.
//
// /api/plan, /api/review-stream and /api/upload became authenticated and
// quota'd. Their existing route tests were written against the unauthenticated
// versions and assert things — prompt shape, body caps, error codes — that have
// nothing to do with the gate. Rather than rewrite each of those to carry its
// own Supabase stub, they mock `@/lib/supabase-server` with this: the caller is
// always signed in, the household always has room, so every one of those tests
// goes on measuring exactly what it was written to measure.
//
// The GATE itself is not tested through this. It has its own tests
// (src/app/api/plan/__tests__/authQuota.test.ts) which drive the real handler
// with the session and the counter varied deliberately. A helper that always
// says "yes" must never be the thing proving the gate works.
// ---------------------------------------------------------------------------

/** Reservation rows written during a test, in order. Cleared per file, not per test. */
export const reservedEvents: Record<string, unknown>[] = [];

/**
 * Stands in for `createClient()` from supabase-server: an authenticated user
 * whose household has used none of its allowance.
 */
export function authedClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }),
    },
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { household_id: 'test-household' } }),
            }),
          }),
        };
      }
      if (table === 'households') {
        // getHouseholdTimezone reads this. A real IANA zone, so businessToday()
        // resolves a genuine month rather than falling back.
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { timezone: 'America/Toronto' } }),
            }),
          }),
        };
      }
      // events — zero used, and inserts always succeed.
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }),
        }),
        insert: (row: Record<string, unknown>) => {
          reservedEvents.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

/** The module shape `vi.mock('@/lib/supabase-server', …)` must return. */
export function supabaseServerMock() {
  return { createClient: async () => authedClient() };
}
