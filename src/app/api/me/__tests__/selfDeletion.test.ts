import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DELETE /api/me — member self-deletion (Case B).
//
// What these tests pin is the ORDER, the REFUSALS and the FAILURE MODES,
// because that is where this feature's correctness actually lives:
//
//   - The record of intent is written BEFORE either mutation. It is the only
//     thing that makes a half-finished deletion discoverable, and it is
//     worthless if it lands after the step it was meant to describe.
//   - Deletion spans two systems that cannot share a transaction (Postgres and
//     Supabase Auth). The auth half failing must leave a RECOVERABLE state, not
//     a 500 and a shrug — access already revoked, marker showing the outstanding
//     work.
//   - Anything that is really Case A is REFUSED and redirected, never quietly
//     carried out. Deleting more than the caller asked to delete is the one
//     unrecoverable mistake this feature can make.
//   - The ledger is never written to. Not "written to carefully" — never.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown };

let ops: string[] = [];
let writes: { table: string; method: string; payload: unknown }[] = [];

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

// --- scripted state, reset per test ----------------------------------------
const SELF = { id: 'mem-1', name: 'Me', user_id: 'user-1', deleted_at: null };
const ACTIVE_OWNER = { id: 'mem-2', name: 'Spouse', user_id: 'user-2', deleted_at: null };

let userRow: Resolution;
let memberRows: unknown[];
let householdUserRows: { id: string; role: string }[];
/** user ids that have NEVER signed in (pending). */
let pendingUserIds: string[];
let intentInsert: Resolution;
let rpcResult: Resolution;
let deleteUserResult: Resolution;
let signOutThrows: boolean;
let signOutArgs: unknown[];
let sessionToken: string | null;

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'departing@example.com' } } }),
      getSession: async () => ({
        data: { session: sessionToken ? { access_token: sessionToken } : null },
      }),
    },
    from: (table: string) => ({
      select: () => {
        ops.push(`user-client:select:${table}`);
        return chain(table === 'users' ? userRow : { data: null, error: null });
      },
      insert: (payload: unknown) => {
        ops.push(`user-client:insert:${table}`);
        writes.push({ table, method: 'insert', payload });
        return chain({ error: null });
      },
      update: (payload: unknown) => {
        ops.push(`user-client:update:${table}`);
        writes.push({ table, method: 'update', payload });
        return chain({ error: null });
      },
      delete: () => {
        ops.push(`user-client:delete:${table}`);
        writes.push({ table, method: 'delete', payload: null });
        return chain({ error: null });
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
        signOut: async (...args: unknown[]) => {
          ops.push('signOut');
          signOutArgs = args;
          if (signOutThrows) throw new Error('sign-out unavailable');
          return { error: null };
        },
        deleteUser: async () => {
          ops.push('deleteUser');
          return deleteUserResult;
        },
      },
    },
    rpc: async (name: string) => {
      ops.push(`rpc:${name}`);
      if (name === 'household_deletion_preview') {
        return { data: { householdName: 'The Test Household', members: 2, transactions: 40 }, error: null };
      }
      return rpcResult;
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

async function deleteMe(body: unknown = { confirmEmail: 'departing@example.com' }) {
  const { DELETE } = await import('../route');
  return DELETE(new Request('http://localhost/api/me', {
    method: 'DELETE',
    body: JSON.stringify(body),
  }));
}

describe('DELETE /api/me — member self-deletion (Case B)', () => {
  beforeEach(() => {
    vi.resetModules();
    ops = [];
    writes = [];
    userRow = { data: { household_id: 'hh1', email: 'departing@example.com' }, error: null };
    // Default household: the caller plus a second ACTIVE owner, so the
    // household carries on without them — the only shape that is Case B.
    memberRows = [SELF, ACTIVE_OWNER];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-2', role: 'owner' }];
    pendingUserIds = [];
    intentInsert = { data: { id: 'req-1' }, error: null };
    rpcResult = { data: { memberId: 'mem-1', purgedChatRows: 0 }, error: null };
    deleteUserResult = { error: null };
    signOutThrows = false;
    signOutArgs = [];
    sessionToken = 'jwt-access-token-abc';
  });

  it('writes the record of intent BEFORE either mutation', async () => {
    const res = await deleteMe();
    expect(res.status).toBe(200);

    const intentAt = ops.indexOf('insert:member_deletion_requests');
    const dbAt = ops.indexOf('rpc:delete_household_member');
    const authAt = ops.indexOf('deleteUser');

    expect(intentAt).toBeGreaterThanOrEqual(0);
    expect(intentAt).toBeLessThan(dbAt);
    expect(intentAt).toBeLessThan(authAt);
    // DB half precedes the auth half, so access is revoked before the
    // irreversible step is attempted.
    expect(dbAt).toBeLessThan(authAt);
  });

  it('records the request as kind=member', async () => {
    await deleteMe();
    const intent = writes.find((w) => w.table === 'member_deletion_requests' && w.method === 'insert');
    expect((intent!.payload as { kind: string }).kind).toBe('member');
    expect((intent!.payload as { member_id: string }).member_id).toBe('mem-1');
  });

  it('aborts with nothing mutated if the intent record cannot be written', async () => {
    intentInsert = { data: null, error: { message: 'insert failed' } };

    const res = await deleteMe();
    expect(res.status).toBe(500);
    expect(ops).not.toContain('rpc:delete_household_member');
    expect(ops).not.toContain('deleteUser');
  });

  // --- refusals: anything that is really Case A ----------------------------

  it('refuses a SOLE MEMBER and points at whole-household deletion', async () => {
    memberRows = [SELF];
    householdUserRows = [{ id: 'user-1', role: 'owner' }];

    const res = await deleteMe();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('household_deletion_required');
    expect(json.reason).toBe('sole_member');
    // Nothing was started — not even the marker.
    expect(ops).not.toContain('insert:member_deletion_requests');
    expect(ops).not.toContain('deleteUser');
  });

  it('refuses when every other member is pending (the escape-hatch shape)', async () => {
    memberRows = [SELF, { ...ACTIVE_OWNER, id: 'mem-3', user_id: 'user-3' }];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-3', role: 'member' }];
    pendingUserIds = ['user-3'];

    const res = await deleteMe();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('household_deletion_required');
    expect(json.reason).toBe('all_pending');
    expect(ops).not.toContain('deleteUser');
  });

  it('blocks a sole owner with an active member, naming who to promote', async () => {
    memberRows = [SELF, ACTIVE_OWNER];
    householdUserRows = [{ id: 'user-1', role: 'owner' }, { id: 'user-2', role: 'member' }];

    const res = await deleteMe();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('promote_first');
    expect(json.candidates.map((c: { id: string }) => c.id)).toEqual(['mem-2']);
    expect(ops).not.toContain('deleteUser');
  });

  // --- confirmation --------------------------------------------------------

  it('requires the caller’s own email, not a generic word', async () => {
    const res = await deleteMe({ confirmEmail: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('confirmation_mismatch');
    expect(ops).not.toContain('insert:member_deletion_requests');
  });

  it('accepts the email in any case, with whitespace', async () => {
    const res = await deleteMe({ confirmEmail: '  Departing@Example.COM ' });
    expect(res.status).toBe(200);
  });

  it('rejects somebody else’s email', async () => {
    const res = await deleteMe({ confirmEmail: 'spouse@example.com' });
    expect(res.status).toBe(400);
    expect(ops).not.toContain('deleteUser');
  });

  // --- failure modes -------------------------------------------------------

  it('a failed auth deletion returns 202 and records the error for retry, not a 500', async () => {
    deleteUserResult = { error: { message: 'auth service unavailable' } };

    const res = await deleteMe();
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json.status).toBe('partial');
    expect(json.requestId).toBe('req-1');

    const errWrite = writes.find(
      (w) => w.table === 'member_deletion_requests' &&
             w.method === 'update' &&
             typeof (w.payload as { last_error?: string }).last_error === 'string'
    );
    expect(errWrite).toBeTruthy();
    expect((errWrite!.payload as { last_error: string }).last_error).toContain('auth:');

    // auth_completed_at must NOT be stamped — the marker has to keep showing
    // this as outstanding, or the ops query goes blind.
    const completion = writes.find(
      (w) => w.table === 'member_deletion_requests' &&
             (w.payload as { auth_completed_at?: string }).auth_completed_at !== undefined
    );
    expect(completion).toBeFalsy();
  });

  it('stamps auth_completed_at only on a fully successful deletion', async () => {
    const res = await deleteMe();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('deleted');

    const completion = writes.find(
      (w) => w.table === 'member_deletion_requests' &&
             (w.payload as { auth_completed_at?: string }).auth_completed_at !== undefined
    );
    expect(completion).toBeTruthy();
    expect((completion!.payload as { last_error: string | null }).last_error).toBeNull();
  });

  it('signs out with the session JWT, not the user id', async () => {
    // admin.signOut's signature is signOut(jwt, scope). Passing a user id there
    // resolves without error and silently revokes nothing — a failure no amount
    // of mocking would surface on its own, so it is asserted explicitly.
    await deleteMe();

    expect(signOutArgs[0]).toBe('jwt-access-token-abc');
    expect(signOutArgs[0]).not.toBe('user-1');
    expect(signOutArgs[1]).toBe('global');
  });

  it('skips sign-out but still completes when no session token is available', async () => {
    sessionToken = null;

    const res = await deleteMe();
    expect(res.status).toBe(200);
    expect(ops).not.toContain('signOut');
    expect(ops).toContain('deleteUser');
  });

  it('a failing global sign-out is non-fatal — it is defence in depth, not the mechanism', async () => {
    signOutThrows = true;

    const res = await deleteMe();
    expect(res.status).toBe(200);
    expect(ops).toContain('deleteUser');
  });

  it('never writes to the ledger', async () => {
    await deleteMe();
    // Case B erases an identity. It does not touch money: no transaction is
    // deleted, relabelled, or re-attributed.
    expect(writes.some((w) => w.table === 'transactions')).toBe(false);
    expect(ops.some((o) => o.includes('transactions'))).toBe(false);
  });
});
