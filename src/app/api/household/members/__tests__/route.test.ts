import { describe, it, expect, vi, beforeEach } from 'vitest';

// Match-before-create: a name-only household_members row created during
// onboarding discovery (user_id null, e.g. quick-add's "Julia") must be
// ATTACHED when later invited by full name, never duplicated. These tests
// mock both the caller's session client (RLS-scoped reads/writes on
// household_members) and the admin client (auth.admin.createUser /
// resetPasswordForEmail).

type Resolution = { data?: unknown; error?: unknown; count?: number };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      }
      return (..._args: unknown[]) => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

type Call = { table: string; method: string; args: unknown[] };

function makeSupabaseMock(script: Record<string, Resolution[]>) {
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
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      update: (...args: unknown[]) => entry(table, 'update', args),
      delete: (...args: unknown[]) => entry(table, 'delete', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

const createUserMock = vi.fn();
const resetPasswordMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: { createUser: (...args: unknown[]) => createUserMock(...args) },
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordMock(...args),
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

describe('POST /api/household/members — match-before-create', () => {
  beforeEach(() => {
    vi.resetModules();
    createUserMock.mockReset();
    resetPasswordMock.mockReset();
  });

  it('a unique name-only match attaches: same member id, attribution intact, email/user_id set', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'new-auth-user' } }, error: null });
    resetPasswordMock.mockResolvedValue({ error: null });

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'owner' }, error: null }],
      household_members: [
        { data: [{ id: 'mem-julia', name: 'Julia' }], error: null }, // name-only candidates
        { data: { name: 'Julia' }, error: null },                    // existing row's current name
        { error: null },                                             // update (attach)
        { data: { id: 'mem-trigger-dup' }, error: null },            // the trigger's brand-new duplicate
        { error: null },                                             // delete the duplicate
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({ email: 'julia@example.com', fullName: 'Julia Alff', role: 'member' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, attached: true, attachedTo: 'Julia Alff' });

    // The EXISTING member id was updated (attribution — recurring_items,
    // transactions, budgets pointing at mem-julia — never touched or re-pointed).
    const updateCall = calls.find((c) => c.table === 'household_members' && c.method === 'update');
    expect(updateCall?.args[0]).toEqual({ user_id: 'new-auth-user', name: 'Julia Alff' });

    // The trigger's freshly-created duplicate (a different id) was removed.
    const deleteCall = calls.find((c) => c.table === 'household_members' && c.method === 'delete');
    expect(deleteCall).toBeTruthy();

    // No second, competing member row is left orphaned — createUser really
    // was called (an email was actually sent to the real Julia).
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(resetPasswordMock).toHaveBeenCalledTimes(1);
  });

  it('a genuinely new name has no candidates and creates normally, with no attach/cleanup calls at all', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'new-auth-user-2' } }, error: null });
    resetPasswordMock.mockResolvedValue({ error: null });

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'owner' }, error: null }],
      household_members: [
        { data: [], error: null }, // no name-only members at all
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({ email: 'marc@example.com', fullName: 'Marc Nobody', role: 'member' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, attached: false, attachedTo: null });

    // Exactly one household_members call total — the candidate lookup.
    // No update, no delete: nothing to attach or clean up.
    const memberCalls = calls.filter((c) => c.table === 'household_members');
    expect(memberCalls).toHaveLength(1);
    expect(memberCalls[0].method).toBe('select');
  });

  it('two name-only members with the same matching name never guess — returns candidates, creates nothing', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'owner' }, error: null }],
      household_members: [
        { data: [{ id: 'm5', name: 'Julia' }, { id: 'm6', name: 'Julia' }], error: null },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({ email: 'julia@example.com', fullName: 'Julia Alff', role: 'member' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.needsDisambiguation).toBe(true);
    expect(json.candidates.map((c: { id: string }) => c.id).sort()).toEqual(['m5', 'm6']);

    // Nothing was created — no account, no email, not even a decision made yet.
    expect(createUserMock).not.toHaveBeenCalled();
    expect(resetPasswordMock).not.toHaveBeenCalled();
    void calls;
  });

  it('attachToMemberId (the owner\'s explicit choice after disambiguation) skips matching and attaches directly', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'new-auth-user-3' } }, error: null });
    resetPasswordMock.mockResolvedValue({ error: null });

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'owner' }, error: null }],
      household_members: [
        { data: { id: 'm5', user_id: null, household_id: 'hh1' }, error: null }, // attachToMemberId validation
        { data: { name: 'Julia' }, error: null },                                // existing row's name
        { error: null },                                                        // update
        { data: null, error: null },                                            // no duplicate found
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({ email: 'julia@example.com', fullName: 'Julia Alff', role: 'member', attachToMemberId: 'm5' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, attached: true, attachedTo: 'Julia Alff' });
    void calls;
  });

  it('forceNew (the owner\'s explicit "create as a new person" choice) skips matching and never attaches', async () => {
    createUserMock.mockResolvedValue({ data: { user: { id: 'new-auth-user-4' } }, error: null });
    resetPasswordMock.mockResolvedValue({ error: null });

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'owner' }, error: null }],
      household_members: [], // no lookups at all — forceNew bypasses matching entirely
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postMembers({ email: 'julia2@example.com', fullName: 'Julia Alff', role: 'member', forceNew: true });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, attached: false, attachedTo: null });
    expect(calls.filter((c) => c.table === 'household_members')).toHaveLength(0);
  });
});
