import { describe, it, expect, vi, beforeEach } from 'vitest';

// Promote-to-owner runs with the SERVICE-ROLE client, which bypasses RLS
// entirely. Every guard the database would normally enforce is therefore the
// route's own responsibility, and these tests exist mainly to prove each one
// is actually there — especially the tenant check on the final UPDATE, which
// is the difference between "promote a member" and "promote anyone in any
// household to owner".

type Resolution = { data?: unknown; error?: unknown };

function resultChain(resolution: Resolution, record?: (method: string, args: unknown[]) => void) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      return (...args: unknown[]) => {
        record?.(String(prop), args);
        return resultChain(resolution, record);
      };
    },
  };
  return new Proxy({}, handler);
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const getUserByIdMock = vi.fn();
const adminUsersSelect = vi.fn();
const adminUsersUpdate = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: (...a: unknown[]) => getUserByIdMock(...a) } },
    from: (table: string) => {
      if (table !== 'users') throw new Error(`admin client used on unexpected table: ${table}`);
      return {
        select: (...a: unknown[]) => adminUsersSelect(...a),
        update: (...a: unknown[]) => adminUsersUpdate(...a),
      };
    },
  }),
}));

type Inserted = { table: string; payload: Record<string, unknown> };

function makeSessionClient(
  callerRow: { household_id: string; role: string } | null,
  memberRow: unknown
) {
  const inserts: Inserted[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: callerRow }) }) }) };
      }
      if (table === 'household_members') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: memberRow }) }) }) };
      }
      if (table === 'events') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            inserts.push({ table, payload });
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table on session client: ${table}`);
    },
  };
  return { client, inserts };
}

async function promote(id = 'mem-1') {
  const { POST } = await import('../route');
  return POST(
    new Request(`http://localhost/api/household/members/${id}/promote`, { method: 'POST' }),
    { params: Promise.resolve({ id }) }
  );
}

async function useSession(client: unknown) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
}

const ACTIVE_MEMBER = { id: 'mem-1', household_id: 'hh1', user_id: 'u-target', name: 'Julia' };

describe('POST /api/household/members/[id]/promote', () => {
  beforeEach(() => {
    vi.resetModules();
    getUserByIdMock.mockReset();
    adminUsersSelect.mockReset();
    adminUsersUpdate.mockReset();
    adminUsersUpdate.mockReturnValue(resultChain({ error: null }));
  });

  it('rejects a non-owner caller before touching the service-role client', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'member' }, ACTIVE_MEMBER);
    await useSession(client);

    const res = await promote();
    expect(res.status).toBe(403);
    expect(adminUsersSelect).not.toHaveBeenCalled();
    expect(adminUsersUpdate).not.toHaveBeenCalled();
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated', async () => {
    const { client } = makeSessionClient(null, ACTIVE_MEMBER);
    await useSession(client);

    const res = await promote();
    expect(res.status).toBe(401);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });

  it('404s for a member in a different household', async () => {
    const { client } = makeSessionClient(
      { household_id: 'hh1', role: 'owner' },
      { ...ACTIVE_MEMBER, household_id: 'hh-other' }
    );
    await useSession(client);

    const res = await promote();
    expect(res.status).toBe(404);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });

  it('400s on a name-only member with no account to promote', async () => {
    const { client } = makeSessionClient(
      { household_id: 'hh1', role: 'owner' },
      { ...ACTIVE_MEMBER, user_id: null }
    );
    await useSession(client);

    const res = await promote();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/hasn't been invited/);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });

  // The service-role client can see EVERY household, so this check is the
  // only thing standing between a stale/forged member row and a cross-tenant
  // role change.
  it('404s when the target users row belongs to another household', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, ACTIVE_MEMBER);
    await useSession(client);
    adminUsersSelect.mockReturnValue(
      resultChain({ data: { id: 'u-target', role: 'member', household_id: 'hh-other' } })
    );

    const res = await promote();
    expect(res.status).toBe(404);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });

  it('400s when the member is already an owner', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, ACTIVE_MEMBER);
    await useSession(client);
    adminUsersSelect.mockReturnValue(
      resultChain({ data: { id: 'u-target', role: 'owner', household_id: 'hh1' } })
    );

    const res = await promote();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already an owner/);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });

  // The load-bearing guard: an owner who never set a password is the
  // ownerless state wearing a hat.
  it('400s on a pending member who has never signed in, and does not change the role', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, ACTIVE_MEMBER);
    await useSession(client);
    adminUsersSelect.mockReturnValue(
      resultChain({ data: { id: 'u-target', role: 'member', household_id: 'hh1' } })
    );
    getUserByIdMock.mockResolvedValue({ data: { user: { last_sign_in_at: null } }, error: null });

    const res = await promote();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/password/i);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });

  it('promotes an active member, scoping the write by household as well as id', async () => {
    const { client, inserts } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, ACTIVE_MEMBER);
    await useSession(client);
    adminUsersSelect.mockReturnValue(
      resultChain({ data: { id: 'u-target', role: 'member', household_id: 'hh1' } })
    );
    getUserByIdMock.mockResolvedValue({
      data: { user: { last_sign_in_at: '2026-07-01T00:00:00Z' } },
      error: null,
    });

    const eqCalls: { method: string; args: unknown[] }[] = [];
    adminUsersUpdate.mockImplementation((...args: unknown[]) => {
      eqCalls.push({ method: 'update', args });
      return resultChain({ error: null }, (method, a) => eqCalls.push({ method, args: a }));
    });

    const res = await promote();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, name: 'Julia' });

    expect(eqCalls[0]).toEqual({ method: 'update', args: [{ role: 'owner' }] });
    // Both filters must be present — id alone would be a cross-tenant write
    // waiting to happen, since RLS is bypassed on this client.
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['id', 'u-target'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['household_id', 'hh1'] });

    const event = inserts.find((i) => i.table === 'events');
    expect(event?.payload).toMatchObject({
      household_id: 'hh1',
      user_id: 'owner-1', // the owner who performed it, not the person promoted
      event_type: 'member_promoted_to_owner',
    });
    expect(event?.payload.metadata).toMatchObject({
      member_id: 'mem-1',
      promoted_user_id: 'u-target',
    });
  });

  it('surfaces a failed role update rather than reporting success', async () => {
    const { client, inserts } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, ACTIVE_MEMBER);
    await useSession(client);
    adminUsersSelect.mockReturnValue(
      resultChain({ data: { id: 'u-target', role: 'member', household_id: 'hh1' } })
    );
    getUserByIdMock.mockResolvedValue({
      data: { user: { last_sign_in_at: '2026-07-01T00:00:00Z' } },
      error: null,
    });
    adminUsersUpdate.mockReturnValue(resultChain({ error: { message: 'permission denied' } }));

    const res = await promote();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('permission denied');
    // No event for something that didn't happen.
    expect(inserts.find((i) => i.table === 'events')).toBeUndefined();
  });

  it('500s when the auth lookup fails, without guessing that the member is active', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, ACTIVE_MEMBER);
    await useSession(client);
    adminUsersSelect.mockReturnValue(
      resultChain({ data: { id: 'u-target', role: 'member', household_id: 'hh1' } })
    );
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await promote();
    expect(res.status).toBe(500);
    expect(adminUsersUpdate).not.toHaveBeenCalled();
  });
});
