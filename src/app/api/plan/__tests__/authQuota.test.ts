import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// The gate on POST /api/plan, exercised through the real route handler.
//
// This route was unauthenticated with only an in-process IP limiter in front
// of it. These tests drive the actual POST export so that "the gate is wired"
// is asserted rather than assumed — a lesson from a recent change that had
// green unit tests around a helper the component never reached.
// ---------------------------------------------------------------------------

const anthropicCreate = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => anthropicCreate(...a) } },
}));

vi.mock('@/lib/householdTimezone', () => ({
  getHouseholdTimezone: async () => 'America/Toronto',
}));

/** Controls what the mocked Supabase client reports for this test. */
let scenario: {
  user: { id: string } | null;
  householdId: string | null;
  count: { count: number | null; error: unknown };
  insertError?: unknown;
};

const inserts: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: scenario.user },
        error: scenario.user ? null : { message: 'no session' },
      }),
    },
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: scenario.householdId ? { household_id: scenario.householdId } : null,
              }),
            }),
          }),
        };
      }
      // events
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => Promise.resolve(scenario.count) }) }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return Promise.resolve({ error: scenario.insertError ?? null });
        },
      };
    },
  }),
}));

function post(body: unknown) {
  return new Request('http://localhost/api/plan', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function callRoute(body: unknown = { source: 'template' }) {
  const { POST } = await import('../route');
  return POST(post(body));
}

beforeEach(() => {
  vi.resetModules();
  anthropicCreate.mockReset();
  anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
  inserts.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  scenario = {
    user: { id: 'user-1' },
    householdId: 'hh-1',
    count: { count: 0, error: null },
  };
});

describe('unauthenticated callers are rejected', () => {
  it('returns 401 NOT_AUTHENTICATED with no session', async () => {
    scenario.user = null;
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('NOT_AUTHENTICATED');
  });

  it('never reaches Anthropic without a session', async () => {
    scenario.user = null;
    await callRoute();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('never consumes a quota slot without a session', async () => {
    scenario.user = null;
    await callRoute();
    expect(inserts).toHaveLength(0);
  });

  it('returns 401 for a signed-in user with no household row', async () => {
    scenario.householdId = null;
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('NOT_AUTHENTICATED');
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
});

describe('an exhausted household is rejected', () => {
  it('returns 429 ONBOARDING_QUOTA_EXHAUSTED at the eleventh generation', async () => {
    scenario.count = { count: 10, error: null };
    const res = await callRoute();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('ONBOARDING_QUOTA_EXHAUSTED');
  });

  it('names the reset date, not just the fact of the limit', async () => {
    // A household that legitimately re-onboarded needs to know WHEN it clears.
    scenario.count = { count: 10, error: null };
    const body = await (await callRoute()).json();
    expect(body.resetsOn).toMatch(/^\d{4}-\d{2}-01$/);
    expect(body.quota.limit).toBe(10);
  });

  it('spends nothing on Anthropic when exhausted', async () => {
    scenario.count = { count: 10, error: null };
    await callRoute();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
});

describe('a quota that cannot be READ is treated as exhausted', () => {
  it('returns 429 rather than allowing the call through', async () => {
    // Fail closed. "I could not read the counter" must never mean "there is
    // room" on a route that bills per call.
    scenario.count = { count: null, error: { message: 'db down' } };
    const res = await callRoute();
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('ONBOARDING_QUOTA_EXHAUSTED');
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
});

describe('a legitimate household still gets through', () => {
  it('passes the gate on a first onboarding and reserves one slot', async () => {
    scenario.count = { count: 0, error: null };
    const res = await callRoute();

    // The route may still refuse the fixture body further down — what this
    // asserts is that the GATE did not refuse it.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(429);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      household_id: 'hh-1',
      user_id: 'user-1',
      event_type: 'onboarding_plan_generated',
    });
  });

  it('passes on a RE-ONBOARDING at the tenth generation of the month', async () => {
    // The primary risk in the brief: a ceiling set too tight breaks a
    // household redoing its budget. Nine used still lets the tenth through.
    scenario.count = { count: 9, error: null };
    const res = await callRoute();
    expect(res.status).not.toBe(429);
    expect(inserts).toHaveLength(1);
  });

  it('stamps the household month on the reservation', async () => {
    await callRoute();
    expect(inserts[0].metadata).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });
});
