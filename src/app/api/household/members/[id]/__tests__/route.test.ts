import { describe, it, expect, vi, beforeEach } from 'vitest';

// DELETE /api/household/members/[id] — revoke a PENDING invite.
//
// The cap makes this necessary: without it one typo'd email address consumes
// one of a household's two slots permanently.
//
// The important invariant is what it does NOT do. It deletes the auth user and
// lets the cascades revert household_members to name-only (user_id is ON
// DELETE SET NULL). It never deletes the member row, because match-before-
// create may have attached this invite to a row that already carries real
// attribution — and transactions.member_id is NO ACTION, so deleting it would
// fail anyway.

const getUserByIdMock = vi.fn();
const deleteUserMock = vi.fn();

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: (...a: unknown[]) => getUserByIdMock(...a),
        deleteUser: (...a: unknown[]) => deleteUserMock(...a),
      },
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
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { client, inserts };
}

async function del(id = 'mem-1') {
  const { DELETE } = await import('../route');
  return DELETE(
    new Request(`http://localhost/api/household/members/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) }
  );
}

async function useSession(client: unknown) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
}

const PENDING_MEMBER = { id: 'mem-1', household_id: 'hh1', user_id: 'u-pending', name: 'Julia' };

describe('DELETE /api/household/members/[id]', () => {
  beforeEach(() => {
    vi.resetModules();
    getUserByIdMock.mockReset();
    deleteUserMock.mockReset();
    deleteUserMock.mockResolvedValue({ error: null });
  });

  it('rejects a non-owner before touching the Admin API', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'member' }, PENDING_MEMBER);
    await useSession(client);

    const res = await del();
    expect(res.status).toBe(403);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('404s for a member in another household', async () => {
    const { client } = makeSessionClient(
      { household_id: 'hh1', role: 'owner' },
      { ...PENDING_MEMBER, household_id: 'hh-other' }
    );
    await useSession(client);

    expect((await del()).status).toBe(404);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('400s on a name-only member — there is no invite to revoke', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, { ...PENDING_MEMBER, user_id: null });
    await useSession(client);

    expect((await del()).status).toBe(400);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('refuses to remove yourself — that is account deletion, not revocation', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, { ...PENDING_MEMBER, user_id: 'owner-1' });
    await useSession(client);

    expect((await del()).status).toBe(400);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  // The load-bearing refusal: an ACTIVE member has a real account with real
  // history. Removing them is account deletion, with its own erasure rules.
  it('refuses an active member who has already signed in', async () => {
    const { client } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, PENDING_MEMBER);
    await useSession(client);
    getUserByIdMock.mockResolvedValue({
      data: { user: { last_sign_in_at: '2026-07-01T00:00:00Z' } },
      error: null,
    });

    const res = await del();
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('member_active');
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('deletes only the auth user for a pending member, and logs it', async () => {
    const { client, inserts } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, PENDING_MEMBER);
    await useSession(client);
    getUserByIdMock.mockResolvedValue({ data: { user: { last_sign_in_at: null } }, error: null });

    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, name: 'Julia' });

    // The auth row goes; the household_members row is left to the SET NULL
    // cascade. Nothing here deletes a member row — that would take the
    // household's attribution with it.
    expect(deleteUserMock).toHaveBeenCalledWith('u-pending');

    const event = inserts.find((i) => i.table === 'events');
    expect(event?.payload).toMatchObject({
      household_id: 'hh1',
      user_id: 'owner-1',
      event_type: 'pending_member_removed',
    });
  });

  it('surfaces a failed auth deletion instead of reporting success', async () => {
    const { client, inserts } = makeSessionClient({ household_id: 'hh1', role: 'owner' }, PENDING_MEMBER);
    await useSession(client);
    getUserByIdMock.mockResolvedValue({ data: { user: { last_sign_in_at: null } }, error: null });
    deleteUserMock.mockResolvedValue({ error: { message: 'auth down' } });

    const res = await del();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('auth down');
    expect(inserts.find((i) => i.table === 'events')).toBeUndefined();
  });
});
