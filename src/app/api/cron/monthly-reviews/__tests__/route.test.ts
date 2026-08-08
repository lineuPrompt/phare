import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// The cron's three hazards: an unauthenticated caller spending money, one
// household's failure abandoning the rest, and a claim that outlives a failed
// generation and blocks the retry forever.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown };

let households: Resolution;
let txRows: Resolution;
let existingReviews: Resolution;
let claimResult: Resolution;
let deleteError: unknown = null;
let generateThrows = false;
let ops: string[] = [];
let deletedClaimIds: string[] = [];

function chain(resolution: Resolution, table: string, method: string): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (r: (v: Resolution) => unknown) => Promise.resolve(resolution).then(r);
      return (...args: unknown[]) => {
        if (method === 'delete' && prop === 'eq') deletedClaimIds.push(String(args[1]));
        return chain(resolution, table, method);
      };
    },
  });
}

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => {
        ops.push(`select:${table}`);
        if (table === 'households') return chain(households, table, 'select');
        if (table === 'transactions') return chain(txRows, table, 'select');
        if (table === 'conversations') return chain(existingReviews, table, 'select');
        return chain({ data: [], error: null }, table, 'select');
      },
      insert: () => { ops.push(`insert:${table}`); return chain(claimResult, table, 'insert'); },
      update: () => { ops.push(`update:${table}`); return chain({ error: null }, table, 'update'); },
      delete: () => { ops.push(`delete:${table}`); return chain({ error: deleteError }, table, 'delete'); },
    }),
  }),
}));

vi.mock('@/lib/householdTimezone', () => ({ getHouseholdTimezone: async () => 'America/Toronto' }));
vi.mock('@/lib/dateHelpers', () => ({ businessToday: () => '2026-09-01' }));
vi.mock('@/lib/monthlyReviewService', () => ({
  generateMonthlyReview: async () => {
    ops.push('generate');
    if (generateThrows) throw new Error('anthropic down');
    return { topRecommendation: 'rec', reviewText: 'text' };
  },
}));

async function runCron(auth = 'Bearer test-secret') {
  const { GET } = await import('../route');
  return GET(new Request('http://localhost/api/cron/monthly-reviews', {
    headers: auth ? { authorization: auth } : {},
  }));
}

describe('monthly review cron', () => {
  beforeEach(() => {
    vi.resetModules();
    ops = [];
    deletedClaimIds = [];
    deleteError = null;
    generateThrows = false;
    process.env.CRON_SECRET = 'test-secret';
    households = { data: [{ id: 'hh1', locale: 'en' }], error: null };
    // Data in August, the month reviewed on 1 September.
    txRows = { data: ['2026-07', '2026-08'].map((m) => ({ date: `${m}-15` })), error: null };
    existingReviews = { data: [], error: null };
    claimResult = { data: { id: 'claim-1' }, error: null };
  });

  // --- authentication -----------------------------------------------------

  it('refuses without the bearer secret — this endpoint spends money', async () => {
    const res = await runCron('');
    expect(res.status).toBe(401);
    expect(ops).not.toContain('generate');
  });

  it('refuses a wrong secret', async () => {
    expect((await runCron('Bearer wrong')).status).toBe(401);
    expect(ops).not.toContain('generate');
  });

  it('refuses to run at all when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    expect((await runCron()).status).toBe(503);
  });

  // --- the happy path -----------------------------------------------------

  it('claims BEFORE generating', async () => {
    await runCron();
    expect(ops.indexOf('insert:conversations')).toBeLessThan(ops.indexOf('generate'));
  });

  it('generates for a due household and fills the claim', async () => {
    const json = await (await runCron()).json();
    expect(json.generated).toBe(1);
    expect(json.outcomes[0]).toMatchObject({ status: 'generated', month: '2026-08' });
    expect(ops).toContain('update:conversations');
  });

  // --- idempotency --------------------------------------------------------

  it('a 23505 on the claim is not an error — another run won', async () => {
    claimResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const json = await (await runCron()).json();
    expect(json.outcomes[0].status).toBe('claimed_by_other');
    expect(ops).not.toContain('generate');
  });

  it('skips a month already generated without even claiming', async () => {
    existingReviews = { data: [{ review_month: '2026-08' }], error: null };
    const json = await (await runCron()).json();
    expect(json.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'already_generated' });
    expect(ops).not.toContain('insert:conversations');
  });

  // --- THE failure mode this design creates -------------------------------

  it('RELEASES the claim when generation fails', async () => {
    // Without this the empty claim satisfies the uniqueness check forever, and
    // the household silently never receives that month — a permanent failure
    // manufactured from a transient one.
    generateThrows = true;
    const json = await (await runCron()).json();

    expect(deletedClaimIds).toContain('claim-1');
    expect(json.outcomes[0]).toMatchObject({ status: 'failed', reason: 'generation_failed' });
  });

  it('reports claim_stuck when the release ITSELF fails', async () => {
    // The one case needing a human, so it must be distinguishable in the body
    // and not collapsed into a generic failure.
    generateThrows = true;
    deleteError = { message: 'db down' };
    const json = await (await runCron()).json();
    expect(json.outcomes[0]).toMatchObject({ status: 'failed', reason: 'claim_stuck' });
  });

  // --- isolation and eligibility ------------------------------------------

  it('one household failing does not stop the others', async () => {
    households = { data: [{ id: 'hh1', locale: 'en' }, { id: 'hh2', locale: 'fr' }], error: null };
    generateThrows = true;
    const json = await (await runCron()).json();
    // Both were attempted, neither abandoned the sweep.
    expect(json.checked).toBe(2);
    expect(json.failed).toBe(2);
  });

  it('generates for a household with only ONE month of data', async () => {
    // The reversal: a family invited in November must not wait until February.
    txRows = { data: [{ date: '2026-08-15' }], error: null };
    const json = await (await runCron()).json();
    expect(json.outcomes[0]).toMatchObject({ status: 'generated', month: '2026-08' });
  });

  it('skips a household with no data for the reviewed month, without claiming', async () => {
    // July rows say nothing about August.
    txRows = { data: [{ date: '2026-07-15' }], error: null };
    const json = await (await runCron()).json();
    expect(json.outcomes[0]).toMatchObject({ status: 'skipped', reason: 'no_data_for_month' });
    expect(ops).not.toContain('insert:conversations');
  });

  it('returns 200 even when households failed — a non-2xx would re-sweep everyone', async () => {
    generateThrows = true;
    const res = await runCron();
    expect(res.status).toBe(200);
  });
});
