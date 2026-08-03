import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// RE-INVITE MUST NOT REATTACH — the rule that makes Case B (member
// self-deletion) safe.
//
// After a member deletes their account, delete_household_member() KEEPS their
// household_members row (transactions.member_id is NOT NULL ... NO ACTION, so
// the row cannot be deleted) and NULLs its user_id. That leaves a row which,
// to every pre-existing query, looks exactly like a name-only row from
// onboarding discovery or quick-add — the very rows match-before-create
// attaches new invites to.
//
// So the failure this file pins is specific and severe: invite someone with
// the departed member's name, and a NEW person's login gets bound to the
// ERASED person's identity row, inheriting their whole attribution history.
// deleted_at is the tombstone that keeps the two apart, and BOTH attach paths
// have to honour it — the name-matching one and the explicit
// attachToMemberId one, which skips matching entirely and is therefore the
// easier of the two to leave open.
//
// The mock here records EVERY chained call, not just the first. That is
// deliberate: the name-match half of this rule lives in a query filter, and a
// mock that silently ignores .is('deleted_at', null) would let a regression
// that drops the filter still pass. Asserting the filter was actually issued
// is the only thing that pins it at this layer.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown; count?: number };
type ChainCall = { method: string; args: unknown[] };
type Chain = { table: string; calls: ChainCall[] };

function makeRecordingChain(resolution: Resolution, chain: Chain): unknown {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      }
      return (...args: unknown[]) => {
        chain.calls.push({ method: String(prop), args });
        return makeRecordingChain(resolution, chain);
      };
    },
  };
  return new Proxy({}, handler);
}

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const chains: Chain[] = [];

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
    from: (table: string) => {
      const chain: Chain = { table, calls: [] };
      const start = (method: string) => (...args: unknown[]) => {
        chains.push(chain);
        chain.calls.push({ method, args });
        const idx = cursors[table] ?? 0;
        cursors[table] = idx + 1;
        const list = script[table] ?? [];
        if (idx >= list.length) {
          throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
        }
        return makeRecordingChain(list[idx], chain);
      };
      return {
        select: start('select'),
        update: start('update'),
        delete: start('delete'),
        insert: start('insert'),
      };
    },
  };

  return { client, chains };
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const createUserMock = vi.fn();
const resetPasswordMock = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: { createUser: (...a: unknown[]) => createUserMock(...a) },
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordMock(...a),
    },
    // The "is this email already ours?" lookup — always "no", so the cap check
    // and the attach logic below both run.
    from: () => {
      const nullChain = (): unknown =>
        new Proxy({}, {
          get(_, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve);
            }
            return () => nullChain();
          },
        });
      return { select: () => nullChain() };
    },
  }),
}));

async function postMembers(body: unknown) {
  const { POST } = await import('../route');
  return POST(new Request('http://localhost/api/household/members', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

const OWNER = { data: { household_id: 'hh1', role: 'owner' }, error: null };

describe('re-invite after a member self-deletion must not reattach', () => {
  beforeEach(() => {
    vi.resetModules();
    createUserMock.mockReset();
    resetPasswordMock.mockReset();
    createUserMock.mockResolvedValue({ data: { user: { id: 'new-auth-user' } }, error: null });
    resetPasswordMock.mockResolvedValue({ error: null });
  });

  it('the name-match candidate query excludes tombstoned rows', async () => {
    const { client, chains } = makeSupabaseMock({
      users: [OWNER],
      household_members: [
        { count: 0, error: null }, // member-cap count
        { data: [], error: null }, // candidate lookup
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    await postMembers({ email: 'julia@example.com', fullName: 'Julia Alff', role: 'member' });

    // The candidate lookup is the one selecting 'id, name'.
    const candidateChain = chains.find(
      (c) => c.table === 'household_members' && c.calls[0]?.args[0] === 'id, name'
    );
    expect(candidateChain).toBeTruthy();

    // It must filter on BOTH: user_id null (name-only) AND deleted_at null
    // (not a tombstone). Dropping the second filter is the regression.
    const isFilters = candidateChain!.calls
      .filter((c) => c.method === 'is')
      .map((c) => c.args);
    expect(isFilters).toContainEqual(['user_id', null]);
    expect(isFilters).toContainEqual(['deleted_at', null]);
  });

  it('an explicitly chosen tombstoned row is refused, and no account is created', async () => {
    const { client, chains } = makeSupabaseMock({
      users: [OWNER],
      household_members: [
        { count: 0, error: null }, // member-cap count
        // The owner picked this id from a stale disambiguation list. It is the
        // departed member's tombstone: user_id null (so the old "already has
        // an account" guard does NOT catch it) but deleted_at set.
        {
          data: {
            id: 'mem-departed',
            user_id: null,
            household_id: 'hh1',
            deleted_at: '2026-08-01T10:00:00Z',
          },
          error: null,
        },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({
      email: 'someone.new@example.com',
      fullName: 'Julia Alff',
      role: 'member',
      attachToMemberId: 'mem-departed',
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('member_deleted');

    // The erased person's row was never re-pointed at a live identity...
    const updates = chains.filter(
      (c) => c.table === 'household_members' && c.calls[0]?.method === 'update'
    );
    expect(updates).toHaveLength(0);

    // ...and the route stopped before creating any auth user or sending mail.
    expect(createUserMock).not.toHaveBeenCalled();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('does not over-refuse: a genuine name-only row still attaches normally', async () => {
    const { client, chains } = makeSupabaseMock({
      users: [OWNER],
      household_members: [
        { count: 0, error: null },
        // Same shape as above but NOT tombstoned — a real quick-add row.
        { data: { id: 'mem-julia', user_id: null, household_id: 'hh1', deleted_at: null }, error: null },
        { data: { name: 'Julia' }, error: null }, // existing row's current name
        { error: null },                          // the attach update
        { data: null, error: null },              // trigger duplicate lookup
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({
      email: 'julia@example.com',
      fullName: 'Julia Alff',
      role: 'member',
      attachToMemberId: 'mem-julia',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.attached).toBe(true);

    const update = chains.find(
      (c) => c.table === 'household_members' && c.calls[0]?.method === 'update'
    );
    expect(update?.calls[0].args[0]).toEqual({ user_id: 'new-auth-user', name: 'Julia Alff' });
  });
});
