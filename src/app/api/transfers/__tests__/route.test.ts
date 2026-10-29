import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/transfers input limits (docs/tickets/transfers-post-input-gaps.md).
 * The same three checks PATCH /api/transfers/[id] has: an amount past the
 * manual-entry ceiling, a date that is not a real calendar date, and a
 * description over 200 characters are each refused with their own code,
 * before any database call — so nothing is read, and nothing is written.
 *
 * "No database call" is observed directly: createClient is the route's only
 * way to the database, so a refusal must leave it uncalled. The passing
 * cases prove the checks are not refusing everything: right at each limit,
 * the route goes on to the database.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

async function setup() {
  const { createClient } = await import('@/lib/supabase-server');
  const createClientMock = createClient as ReturnType<typeof vi.fn>;
  createClientMock.mockReset();
  // Past the checks, the route asks who is signed in: answer "nobody", so a
  // request that gets this far ends at 401 without touching anything else.
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
  const { POST } = await import('../route');
  return { POST, createClientMock };
}

const post = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/transfers', { method: 'POST', body: JSON.stringify(body) });

const VALID = { date: '2026-10-29', amount: 50, goalAccountId: 'goal-1' };

describe('POST /api/transfers — input limits, before any database call', () => {
  beforeEach(() => { vi.resetModules(); });

  it.each([
    ['an amount past the ceiling', { amount: 1_000_000_000 }, 'INVALID_AMOUNT'],
    ['a date that is not a calendar date', { date: '2026-02-30' }, 'INVALID_DATE'],
    ['a date not written as YYYY-MM-DD', { date: '29/10/2026' }, 'INVALID_DATE'],
    ['a description past 200 characters', { description: 'x'.repeat(201) }, 'DESCRIPTION_TOO_LONG'],
  ])('%s is refused (400 %s) and the database is never reached', async (_label, override, code) => {
    const { POST, createClientMock } = await setup();
    const res = await POST(post({ ...VALID, ...override }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it.each([
    ['the ceiling amount itself', { amount: 999_999_999.99 }],
    ['a leap day', { date: '2028-02-29' }],
    ['a description of exactly 200 characters', { description: 'x'.repeat(200) }],
    ['200 characters plus surrounding spaces (trimmed before counting)', { description: `  ${'x'.repeat(200)}  ` }],
  ])('%s passes the checks and goes on to the database', async (_label, override) => {
    const { POST, createClientMock } = await setup();
    const res = await POST(post({ ...VALID, ...override }));
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });
});
