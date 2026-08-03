import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CURRENT_LEGAL_VERSION } from '@/lib/legalVersions';

// ---------------------------------------------------------------------------
// POST /api/legal/accept
//
// What matters here is that the record is EVIDENCE, not a self-reported claim:
//   - it is written with the service-role client, because the users RLS policy
//     is `id = auth.uid()` and a user could otherwise stamp their own consent;
//   - the version written is the SERVER's constant, never the client's string;
//   - a client showing a stale document is refused rather than having its
//     acceptance silently recorded against text it never displayed.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown };

let writes: { table: string; payload: unknown }[] = [];
let adminUsed = false;
let authedUser: { id: string } | null = { id: 'user-1' };
let updateResult: Resolution = { error: null };

function chain(resolution: Resolution): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown) => Promise.resolve(resolution).then(resolve);
      }
      return () => chain(resolution);
    },
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authedUser } }) },
    from: () => ({
      // If the route ever writes through the CALLER's client, this records it
      // and the evidence test below fails.
      update: (payload: unknown) => {
        writes.push({ table: 'users(user-client)', payload });
        return chain({ error: null });
      },
      select: () => chain({ data: null, error: null }),
    }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => {
    adminUsed = true;
    return {
      from: (table: string) => ({
        update: (payload: unknown) => {
          writes.push({ table, payload });
          return chain(updateResult);
        },
      }),
    };
  },
}));

async function accept(body: unknown) {
  const { POST } = await import('../route');
  return POST(new Request('http://localhost/api/legal/accept', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

describe('POST /api/legal/accept', () => {
  beforeEach(() => {
    vi.resetModules();
    writes = [];
    adminUsed = false;
    authedUser = { id: 'user-1' };
    updateResult = { error: null };
  });

  it('records acceptance with a timestamp and the current version', async () => {
    const res = await accept({ version: CURRENT_LEGAL_VERSION });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accepted).toBe(true);
    expect(json.termsVersion).toBe(CURRENT_LEGAL_VERSION);

    const write = writes.find((w) => w.table === 'users');
    expect(write).toBeTruthy();
    const payload = write!.payload as { terms_accepted_at: string; terms_version: string };
    expect(payload.terms_version).toBe(CURRENT_LEGAL_VERSION);
    expect(Number.isNaN(Date.parse(payload.terms_accepted_at))).toBe(false);
  });

  it('writes through the service-role client, never the caller’s own', async () => {
    // The users RLS policy is `id = auth.uid()`, so a write through the
    // caller's client would be a consent record the consenting party can
    // rewrite — which is not evidence of anything.
    await accept({ version: CURRENT_LEGAL_VERSION });

    expect(adminUsed).toBe(true);
    expect(writes.some((w) => w.table === 'users(user-client)')).toBe(false);
  });

  it('refuses a stale version instead of recording a false acceptance', async () => {
    const res = await accept({ version: '1999-01-01' });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('version_mismatch');
    expect(json.currentVersion).toBe(CURRENT_LEGAL_VERSION);
    // Nothing written — the alternative is recording consent to text the user
    // was never shown.
    expect(writes).toHaveLength(0);
  });

  it('never takes the version from the client, even a plausible one', async () => {
    // A client claiming some other string must not be able to author the stored
    // value; it is rejected outright rather than trusted.
    const res = await accept({ version: 'v2' });
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it('rejects a missing or non-string version', async () => {
    for (const body of [{}, { version: 42 }, { version: null }]) {
      writes = [];
      const res = await accept(body);
      expect(res.status).toBe(409);
      expect(writes).toHaveLength(0);
    }
  });

  it('requires authentication', async () => {
    authedUser = null;
    const res = await accept({ version: CURRENT_LEGAL_VERSION });
    expect(res.status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('is idempotent — accepting twice is not an error', async () => {
    // Otherwise a double-click becomes a visible failure on a screen the user
    // cannot get past.
    expect((await accept({ version: CURRENT_LEGAL_VERSION })).status).toBe(200);
    expect((await accept({ version: CURRENT_LEGAL_VERSION })).status).toBe(200);
  });

  it('surfaces a write failure rather than claiming success', async () => {
    updateResult = { error: { message: 'db down' } };
    const res = await accept({ version: CURRENT_LEGAL_VERSION });
    expect(res.status).toBe(500);
  });
});
