import { describe, it, expect, vi, beforeEach } from 'vitest';

// Owner gate, rate limit, and honest-error surfacing for the resend-invite
// route. Mocks both the caller's session client (household_members read/
// write) and the admin client (getUserById / resetPasswordForEmail).

type Resolution = { data?: unknown; error?: unknown };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      return (..._args: unknown[]) => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

type Call = { table: string; method: string; args: unknown[] };

function makeSupabaseMock(
  userRow: { household_id: string; role: string } | null,
  script: Record<string, Resolution[]>
) {
  const cursors: Record<string, number> = {};
  const calls: Call[] = [];

  function entry(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
    },
    from: (table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: userRow }) }) }) };
      }
      return {
        select: (...args: unknown[]) => entry(table, 'select', args),
        update: (...args: unknown[]) => entry(table, 'update', args),
      };
    },
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

const getUserByIdMock = vi.fn();
const resetPasswordMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: { getUserById: (...args: unknown[]) => getUserByIdMock(...args) },
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordMock(...args),
    },
  }),
}));

async function postResend(id: string) {
  const { POST } = await import('../route');
  return POST(
    new Request(`http://localhost/api/household/members/${id}/resend`, { method: 'POST' }),
    { params: Promise.resolve({ id }) }
  );
}

describe('POST /api/household/members/[id]/resend', () => {
  beforeEach(() => {
    vi.resetModules();
    getUserByIdMock.mockReset();
    resetPasswordMock.mockReset();
  });

  it('rejects a non-owner caller before touching the Admin API', async () => {
    const { client } = makeSupabaseMock({ household_id: 'hh1', role: 'member' }, {});
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postResend('mem-1');
    expect(res.status).toBe(403);
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('404s when the member is not found or belongs to a different household', async () => {
    const { client } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [{ data: { id: 'mem-1', household_id: 'hh-other', user_id: 'u1', last_resend_at: null }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postResend('mem-1');
    expect(res.status).toBe(404);
  });

  it('400s on a name-only member (no user_id) — nothing to resend to', async () => {
    const { client } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [{ data: { id: 'mem-1', household_id: 'hh1', user_id: null, last_resend_at: null }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postResend('mem-1');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/hasn't been invited/);
  });

  it('429s with a wait time when called again inside the 60s window', async () => {
    const recentIso = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    const { client } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [{ data: { id: 'mem-1', household_id: 'hh1', user_id: 'u1', last_resend_at: recentIso }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postResend('mem-1');
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
    expect(json.retryAfterSeconds).toBeLessThanOrEqual(50);
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('400s when the member has already signed in (account active, not pending)', async () => {
    const { client } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [{ data: { id: 'mem-1', household_id: 'hh1', user_id: 'u1', last_resend_at: null }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    getUserByIdMock.mockResolvedValue({
      data: { user: { email: 'julia@example.com', last_sign_in_at: '2026-07-01T00:00:00Z' } },
      error: null,
    });

    const res = await postResend('mem-1');
    expect(res.status).toBe(400);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('surfaces the real error when resetPasswordForEmail fails, and does not stamp last_resend_at', async () => {
    const { client, calls } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [{ data: { id: 'mem-1', household_id: 'hh1', user_id: 'u1', last_resend_at: null }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    getUserByIdMock.mockResolvedValue({
      data: { user: { email: 'julia@example.com', last_sign_in_at: null } },
      error: null,
    });
    resetPasswordMock.mockResolvedValue({ error: { message: 'SMTP quota exceeded' } });

    const res = await postResend('mem-1');
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('SMTP quota exceeded');
    expect(calls.some((c) => c.table === 'household_members' && c.method === 'update')).toBe(false);
  });

  it('on success, resends and stamps last_resend_at', async () => {
    const { client, calls } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [
        { data: { id: 'mem-1', household_id: 'hh1', user_id: 'u1', last_resend_at: null }, error: null },
        { error: null }, // update last_resend_at
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    getUserByIdMock.mockResolvedValue({
      data: { user: { email: 'julia@example.com', last_sign_in_at: null } },
      error: null,
    });
    resetPasswordMock.mockResolvedValue({ error: null });

    const res = await postResend('mem-1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, email: 'julia@example.com' });
    expect(resetPasswordMock).toHaveBeenCalledWith('julia@example.com', expect.objectContaining({
      redirectTo: expect.stringContaining('/auth/callback'),
    }));

    const updateCall = calls.find((c) => c.table === 'household_members' && c.method === 'update');
    expect(updateCall?.args[0]).toHaveProperty('last_resend_at');
  });

  it('a member older than the 60s window can resend again', async () => {
    const oldIso = new Date(Date.now() - 90_000).toISOString(); // 90s ago
    const { client } = makeSupabaseMock({ household_id: 'hh1', role: 'owner' }, {
      household_members: [
        { data: { id: 'mem-1', household_id: 'hh1', user_id: 'u1', last_resend_at: oldIso }, error: null },
        { error: null },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    getUserByIdMock.mockResolvedValue({
      data: { user: { email: 'julia@example.com', last_sign_in_at: null } },
      error: null,
    });
    resetPasswordMock.mockResolvedValue({ error: null });

    const res = await postResend('mem-1');
    expect(res.status).toBe(200);
  });
});
