import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUOTA_EVENT_TYPES } from '@/lib/clientEvents';

// ---------------------------------------------------------------------------
// after() is captured rather than executed, for two reasons:
//   1. calling the real after() outside a request scope throws;
//   2. holding the callbacks is what lets these tests PROVE the insert is
//      deferred — the response is asserted complete while the row still does
//      not exist, and only then are the callbacks drained.
// Replacing after(...) with await in the route makes that pair of assertions
// fail, which is the whole point.
// ---------------------------------------------------------------------------
const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => unknown) => { afterCallbacks.push(fn); },
  };
});

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

async function drainAfter() {
  const pending = afterCallbacks.splice(0, afterCallbacks.length);
  for (const fn of pending) await fn();
}

type Inserted = Record<string, unknown>;

function makeSupabase(opts: {
  user?: { id: string } | null;
  householdId?: string | null;
  insertError?: { message: string } | null;
} = {}) {
  const {
    user = { id: 'user-1' },
    householdId = 'household-1',
    insertError = null,
  } = opts;

  const inserts: Inserted[] = [];
  const tablesTouched: string[] = [];

  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table: string) {
      tablesTouched.push(table);
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: householdId ? { household_id: householdId } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'events') {
        return {
          insert: async (row: Inserted) => {
            inserts.push(row);
            return { error: insertError };
          },
        };
      }
      throw new Error(`Unexpected table "${table}"`);
    },
  };

  return { client, inserts, tablesTouched };
}

async function post(body: unknown, supabaseMock: ReturnType<typeof makeSupabase>) {
  const { createClient } = await import('@/lib/supabase-server');
  vi.mocked(createClient).mockResolvedValue(
    supabaseMock.client as unknown as Awaited<ReturnType<typeof createClient>>
  );
  const { POST } = await import('../route');
  return POST(
    new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  // Resets the route module's in-process rate limiter between tests, so one
  // test's 30 requests cannot exhaust the next one's budget.
  vi.resetModules();
  afterCallbacks.length = 0;
  vi.clearAllMocks();
});

// ===========================================================================
// THE SECURITY PROPERTY
// ===========================================================================
describe('POST /api/events — quota event types are refused', () => {
  for (const forbidden of QUOTA_EVENT_TYPES) {
    it(`refuses '${forbidden}' with 400 and writes nothing`, async () => {
      const supabase = makeSupabase();
      const res = await post({ type: forbidden }, supabase);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'unknown_event_type' });

      // Nothing scheduled, nothing written, and the events table was never
      // even reached. A route without the allowlist fails all three.
      expect(afterCallbacks).toHaveLength(0);
      await drainAfter();
      expect(supabase.inserts).toEqual([]);
      expect(supabase.tablesTouched).not.toContain('events');
    });

    it(`refuses '${forbidden}' carrying the month payload the quota reserver writes`, async () => {
      const supabase = makeSupabase();
      const res = await post({ type: forbidden, metadata: { month: '2026-09' } }, supabase);

      expect(res.status).toBe(400);
      await drainAfter();
      expect(supabase.inserts).toEqual([]);
    });
  }

  it('does not echo the rejected type back to the caller', async () => {
    const supabase = makeSupabase();
    const res = await post({ type: 'review_regenerated' }, supabase);
    expect(JSON.stringify(await res.json())).not.toContain('review_regenerated');
  });
});

// ===========================================================================
// THE HAPPY PATH
// ===========================================================================
describe('POST /api/events — accepts allowlisted events', () => {
  it('records onboarding_entry_viewed and returns 204 with no body', async () => {
    const supabase = makeSupabase();
    const res = await post({ type: 'onboarding_entry_viewed' }, supabase);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    await drainAfter();
    expect(supabase.inserts).toEqual([{
      household_id: 'household-1',
      user_id: 'user-1',
      event_type: 'onboarding_entry_viewed',
      metadata: null,
    }]);
  });

  it.each(['template', 'manual'])('records onboarding_path_chosen path=%s', async (path) => {
    const supabase = makeSupabase();
    const res = await post({ type: 'onboarding_path_chosen', metadata: { path } }, supabase);

    expect(res.status).toBe(204);
    await drainAfter();
    expect(supabase.inserts[0]).toMatchObject({
      event_type: 'onboarding_path_chosen',
      metadata: { path },
    });
  });
});

// ===========================================================================
// DEFERRAL — the insert must be off the response path but must still happen
// ===========================================================================
describe('POST /api/events — the insert is deferred, not awaited', () => {
  it('responds 204 BEFORE the row exists, then writes it', async () => {
    const supabase = makeSupabase();
    const res = await post({ type: 'onboarding_entry_viewed' }, supabase);

    expect(res.status).toBe(204);
    // The response is fully resolved and the row does not exist yet. If the
    // route awaited the insert instead of scheduling it, this would already
    // hold one row.
    expect(supabase.inserts).toEqual([]);
    expect(afterCallbacks).toHaveLength(1);

    await drainAfter();
    expect(supabase.inserts).toHaveLength(1);
  });

  it('still returns 204 when the deferred insert fails', async () => {
    // By the time after() runs the response is on the wire; there is no status
    // left to change, and emitClientEvent ignores it regardless.
    const supabase = makeSupabase({ insertError: { message: 'boom' } });
    const res = await post({ type: 'onboarding_entry_viewed' }, supabase);

    expect(res.status).toBe(204);
    await expect(drainAfter()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// AUTH AND TENANCY
// ===========================================================================
describe('POST /api/events — auth and household derivation', () => {
  it('401s an unauthenticated caller and writes nothing', async () => {
    const supabase = makeSupabase({ user: null });
    const res = await post({ type: 'onboarding_entry_viewed' }, supabase);

    expect(res.status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
    await drainAfter();
    expect(supabase.inserts).toEqual([]);
  });

  it('400s a user with no household row', async () => {
    const supabase = makeSupabase({ householdId: null });
    const res = await post({ type: 'onboarding_entry_viewed' }, supabase);

    expect(res.status).toBe(400);
    await drainAfter();
    expect(supabase.inserts).toEqual([]);
  });

  it('derives household_id from the users table and ignores the body', async () => {
    const supabase = makeSupabase({ householdId: 'derived-household' });
    const res = await post(
      {
        type: 'onboarding_entry_viewed',
        household_id: 'attacker-household',
        householdId: 'attacker-household',
        user_id: 'attacker-user',
      },
      supabase
    );

    expect(res.status).toBe(204);
    await drainAfter();
    expect(supabase.inserts[0]).toMatchObject({
      household_id: 'derived-household',
      user_id: 'user-1',
    });
  });
});

// ===========================================================================
// MALFORMED INPUT
// ===========================================================================
describe('POST /api/events — malformed input', () => {
  it('400s unparseable JSON rather than throwing', async () => {
    const supabase = makeSupabase();
    const res = await post('{not json', supabase);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'malformed_body' });
  });

  it('400s an undeclared metadata key', async () => {
    const supabase = makeSupabase();
    const res = await post(
      { type: 'onboarding_path_chosen', metadata: { path: 'manual', fileName: 'budget.xlsx' } },
      supabase
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'unknown_metadata_key' });
    await drainAfter();
    expect(supabase.inserts).toEqual([]);
  });

  it('400s a metadata value outside the declared set', async () => {
    const supabase = makeSupabase();
    const res = await post(
      { type: 'onboarding_path_chosen', metadata: { path: 'someone@example.com' } },
      supabase
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_metadata_value' });
  });

  it('rejects before spending an auth round trip', async () => {
    const supabase = makeSupabase();
    const res = await post({ type: 'not_a_real_event' }, supabase);
    expect(res.status).toBe(400);
    expect(supabase.tablesTouched).toEqual([]);
  });
});

// ===========================================================================
// RATE LIMIT
// ===========================================================================
describe('POST /api/events — rate limit', () => {
  it('allows 30 in the window and 429s the 31st', async () => {
    const supabase = makeSupabase();
    for (let i = 0; i < 30; i++) {
      const ok = await post({ type: 'onboarding_entry_viewed' }, supabase);
      expect(ok.status).toBe(204);
    }
    const blocked = await post({ type: 'onboarding_entry_viewed' }, supabase);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});
