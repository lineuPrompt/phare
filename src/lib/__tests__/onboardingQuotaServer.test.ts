import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readOnboardingQuota,
  reserveOnboardingGeneration,
} from '../onboardingQuotaServer';
import { PLAN_GENERATION_EVENT } from '../onboardingQuota';

// ---------------------------------------------------------------------------
// The DB-backed allowance. What matters here is not the happy path — it is the
// three refusals: exhausted, unwritable, and unreadable. The last one is the
// dangerous one, because "I could not read the counter" must never be treated
// as "there is room".
// ---------------------------------------------------------------------------

vi.mock('@/lib/householdTimezone', () => ({
  getHouseholdTimezone: async () => 'America/Toronto',
}));

type CountResult = { count: number | null; error: unknown };

/**
 * A Supabase stand-in with exactly the two shapes this module uses: a counting
 * select on `events`, and an insert on `events`.
 */
function makeClient(opts: {
  count?: CountResult;
  insertError?: unknown;
}) {
  const inserts: Record<string, unknown>[] = [];
  const count = opts.count ?? { count: 0, error: null };

  const client = {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve(count),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
      };
    },
  };

  return { client, inserts };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('readOnboardingQuota', () => {
  it('reports what has been used', async () => {
    const { client } = makeClient({ count: { count: 3, error: null } });
    const q = await readOnboardingQuota(client, 'hh-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(q).toMatchObject({ used: 3, limit: 10, remaining: 7, allowed: true });
  });

  it('FAILS CLOSED when the count cannot be read', async () => {
    // The assertion that matters most in this file. An unreadable counter
    // reported as "0 used" would authorise unmetered Anthropic spend for as
    // long as the read stays broken.
    const { client } = makeClient({ count: { count: null, error: { message: 'boom' } } });
    const q = await readOnboardingQuota(client, 'hh-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('treats a null count with no error as zero used, not as a failure', async () => {
    const { client } = makeClient({ count: { count: null, error: null } });
    const q = await readOnboardingQuota(client, 'hh-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(0);
  });
});

describe('reserveOnboardingGeneration', () => {
  it('claims a slot and stamps the month on the row', async () => {
    const { client, inserts } = makeClient({ count: { count: 2, error: null } });
    const r = await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');

    expect(r.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      household_id: 'hh-1',
      user_id: 'user-1',
      event_type: PLAN_GENERATION_EVENT,
      metadata: { month: '2026-08' },
    });
  });

  it('lets a legitimate re-onboarding through at the tenth', async () => {
    // The primary risk named in the brief: a quota set too tight breaks a
    // household that genuinely re-onboards. Nine used means the tenth is
    // allowed and actually writes.
    const { client, inserts } = makeClient({ count: { count: 9, error: null } });
    const r = await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(r.ok).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('refuses the eleventh as exhausted, and writes nothing', async () => {
    const { client, inserts } = makeClient({ count: { count: 10, error: null } });
    const r = await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: 'exhausted' });
    // A refused call must not consume a slot on its way out.
    expect(inserts).toHaveLength(0);
  });

  it('refuses when the counter cannot be read, without writing', async () => {
    const { client, inserts } = makeClient({ count: { count: null, error: { message: 'boom' } } });
    const r = await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(r.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('refuses when the reservation cannot be WRITTEN', async () => {
    // A swallowed write is an uncounted generation, and enough of those make
    // the limit fiction. The insert failure is fatal, not logged and ignored.
    const { client } = makeClient({
      count: { count: 0, error: null },
      insertError: { message: 'insert failed' },
    });
    const r = await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: 'unavailable' });
  });

  it('reserves BEFORE the model runs, so a failed generation still costs a slot', async () => {
    // Reserve-then-generate. The alternative makes a failing prompt retryable
    // without limit, which is the exact spend this bounds.
    const { client, inserts } = makeClient({ count: { count: 0, error: null } });
    await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(inserts).toHaveLength(1);
  });

  it('carries the reset date on every refusal', async () => {
    const { client } = makeClient({ count: { count: 10, error: null } });
    const r = await reserveOnboardingGeneration(client, 'hh-1', 'user-1', PLAN_GENERATION_EVENT, '2026-08');
    expect(r.quota.resetsOn).toBe('2026-09-01');
  });
});
