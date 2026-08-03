import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DELETE /api/household — Case A, whole-household deletion.
//
// The ordering here is the MIRROR IMAGE of Case B, and that is the thing most
// worth pinning. member_deletion_requests.household_id cascades from
// households, so dropping the household destroys the marker row describing the
// operation. Therefore:
//
//     intent → erase every auth identity (caller LAST) → drop the household
//
// If the household went first, every Case A that died halfway would leave
// nothing to find. The marker's continued existence is the "unfinished"
// signal; its disappearance is the success signal.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown };

let ops: string[] = [];
let writes: { table: string; method: string; payload: unknown }[] = [];
let deletedUserIds: string[] = [];

function chain(resolution: Resolution): unknown {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      }
      return () => chain(resolution);
    },
  };
  return new Proxy({}, handler);
}

const SELF = { id: 'mem-1', name: 'Me', user_id: 'user-1', deleted_at: null };

let userRow: Resolution;
let memberRows: unknown[];
let householdUserRows: { id: string; role: string }[];
let pendingUserIds: string[];
let intentInsert: Resolution;
let deleteHouseholdResult: Resolution;
/** user ids whose auth deletion should fail. */
let failingAuthIds: string[];

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'owner@example.com' } } }) },
    from: (table: string) => ({
      select: () => {
        ops.push(`user-client:select:${table}`);
        return chain(table === 'users' ? userRow : { data: null, error: null });
      },
    }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { last_sign_in_at: pendingUserIds.includes(id) ? null : '2026-07-01T00:00:00Z' } },
        }),
        deleteUser: async (id: string) => {
          ops.push('deleteUser');
          deletedUserIds.push(id);
          return failingAuthIds.includes(id) ? { error: { message: 'boom' } } : { error: null };
        },
      },
    },
    rpc: async (name: string) => {
      ops.push(`rpc:${name}`);
      if (name === 'household_deletion_preview') {
        return {
          data: { householdName: 'The Test Household', members: 2, transactions: 40, monthsOfHistory: 6 },
          error: null,
        };
      }
      return deleteHouseholdResult;
    },
    from: (table: string) => ({
      select: () => {
        ops.push(`select:${table}`);
        if (table === 'household_members') return chain({ data: memberRows, error: null });
        if (table === 'users') return chain({ data: householdUserRows, error: null });
        return chain({ data: null, error: null });
      },
      insert: (payload: unknown) => {
        ops.push(`insert:${table}`);
        writes.push({ table, method: 'insert', payload });
        return chain(intentInsert);
      },
      update: (payload: unknown) => {
        ops.push(`update:${table}`);
        writes.push({ table, method: 'update', payload });
        return chain({ error: null });
      },
    }),
  }),
}));

async function deleteHousehold(body: unknown = { confirmHouseholdName: 'The Test Household' }) {
  const { DELETE } = await import('../route');
  return DELETE(new Request('http://localhost/api/household', {
    method: 'DELETE',
    body: JSON.stringify(body),
  }));
}

describe('DELETE /api/household — Case A', () => {
  beforeEach(() => {
    vi.resetModules();
    ops = [];
    writes = [];
    deletedUserIds = [];
    userRow = { data: { household_id: 'hh1', role: 'owner', email: 'owner@example.com' }, error: null };
    // Default: sole member — their account IS the household.
    memberRows = [SELF];
    householdUserRows = [{ id: 'user-1', role: 'owner' }];
    pendingUserIds = [];
    intentInsert = { data: { id: 'req-1' }, error: null };
    deleteHouseholdResult = { data: { householdDeleted: true, householdName: 'The Test Household' }, error: null };
    failingAuthIds = [];
  });

  it('deletes a sole-member household: intent, then auth, then the household row', async () => {
    const res = await deleteHousehold();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('deleted');

    const intentAt = ops.indexOf('insert:member_deletion_requests');
    const authAt = ops.indexOf('deleteUser');
    const dropAt = ops.indexOf('rpc:delete_household');

    expect(intentAt).toBeGreaterThanOrEqual(0);
    expect(intentAt).toBeLessThan(authAt);
    // The inversion relative to Case B: identities first, household LAST, so
    // the marker survives for as long as there is outstanding work.
    expect(authAt).toBeLessThan(dropAt);
  });

  it('records the request as kind=household with no member_id', async () => {
    await deleteHousehold();
    const intent = writes.find((w) => w.table === 'member_deletion_requests' && w.method === 'insert');
    expect((intent!.payload as { kind: string }).kind).toBe('household');
    expect((intent!.payload as { member_id: unknown }).member_id).toBeNull();
  });

  it('erases the caller’s own identity LAST', async () => {
    // So that a loop that dies partway leaves the initiator able to sign in
    // and retry, rather than locked out of a half-deleted household.
    memberRows = [SELF, { id: 'mem-2', name: 'Invited', user_id: 'user-2', deleted_at: null }];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-2', role: 'member' }];
    pendingUserIds = ['user-2']; // all-pending escape hatch

    await deleteHousehold();

    expect(deletedUserIds).toEqual(['user-2', 'user-1']);
  });

  it('takes the all-pending escape hatch when nobody else has ever signed in', async () => {
    memberRows = [SELF, { id: 'mem-2', name: 'Invited', user_id: 'user-2', deleted_at: null }];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-2', role: 'member' }];
    pendingUserIds = ['user-2'];

    const res = await deleteHousehold();
    expect(res.status).toBe(200);
    expect(ops).toContain('rpc:delete_household');
  });

  it('refuses when another ACTIVE member could be promoted instead', async () => {
    memberRows = [SELF, { id: 'mem-2', name: 'Spouse', user_id: 'user-2', deleted_at: null }];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-2', role: 'member' }];
    pendingUserIds = []; // they have signed in — the household is theirs too

    const res = await deleteHousehold();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('promote_first');
    expect(json.candidates.map((c: { id: string }) => c.id)).toEqual(['mem-2']);
    // Nothing at all was started.
    expect(ops).not.toContain('insert:member_deletion_requests');
    expect(deletedUserIds).toEqual([]);
  });

  it('refuses a non-owner', async () => {
    userRow = { data: { household_id: 'hh1', role: 'member', email: 'member@example.com' }, error: null };

    const res = await deleteHousehold();
    expect(res.status).toBe(403);
    expect(deletedUserIds).toEqual([]);
  });

  it('requires the household name typed exactly, not a generic word', async () => {
    const res = await deleteHousehold({ confirmHouseholdName: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('confirmation_mismatch');
    expect(ops).not.toContain('insert:member_deletion_requests');
    expect(deletedUserIds).toEqual([]);
  });

  it('accepts the household name in any case, with whitespace', async () => {
    const res = await deleteHousehold({ confirmHouseholdName: '  the test household ' });
    expect(res.status).toBe(200);
  });

  it('does NOT drop the household when an auth deletion fails', async () => {
    memberRows = [SELF, { id: 'mem-2', name: 'Invited', user_id: 'user-2', deleted_at: null }];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-2', role: 'member' }];
    pendingUserIds = ['user-2'];
    failingAuthIds = ['user-2'];

    const res = await deleteHousehold();
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json.status).toBe('partial');
    // The household stays intact and reachable, so the retry is a retry rather
    // than a recovery from a half-destroyed state.
    expect(ops).not.toContain('rpc:delete_household');

    const errWrite = writes.find(
      (w) => w.table === 'member_deletion_requests' &&
             typeof (w.payload as { last_error?: string }).last_error === 'string'
    );
    expect(errWrite).toBeTruthy();
  });

  it('reports 202 (not 500) when identities are gone but the household drop fails', async () => {
    deleteHouseholdResult = { data: null, error: { message: 'deadlock' } };

    const res = await deleteHousehold();
    const json = await res.json();

    // Every identity really was erased, so claiming a plain failure would be
    // false. The marker row survives — with auth_completed_at set — and says
    // exactly what is left to do.
    expect(res.status).toBe(202);
    expect(json.status).toBe('partial');
    expect(json.requestId).toBe('req-1');

    const stamped = writes.find(
      (w) => (w.payload as { auth_completed_at?: string }).auth_completed_at !== undefined
    );
    expect(stamped).toBeTruthy();
  });

  it('aborts with nothing mutated if the intent record cannot be written', async () => {
    intentInsert = { data: null, error: { message: 'insert failed' } };

    const res = await deleteHousehold();
    expect(res.status).toBe(500);
    expect(deletedUserIds).toEqual([]);
    expect(ops).not.toContain('rpc:delete_household');
  });
});
