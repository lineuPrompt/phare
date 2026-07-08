import { describe, it, expect } from 'vitest';
import { ensureChequingAccount, AccountClient } from '../accountHelpers';

// ---------------------------------------------------------------------------
// Mock factory — same Proxy-based thenable-chain approach as eventLogger.test.ts.
// Resolves any chain of .eq()/.limit()/.maybeSingle()/.single() calls to a
// fixed { data, error } result.
// ---------------------------------------------------------------------------

function makeChain(resolution: { data: unknown; error: { message: string } | null }) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (
          resolve: (v: typeof resolution) => unknown,
          reject?: (v: unknown) => unknown
        ) => Promise.resolve(resolution).then(resolve, reject);
      }
      return () => makeChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

function makeSupabase({
  existingId = null,
  selectError = null,
  insertedId = null,
  insertError = null,
}: {
  existingId?: string | null;
  selectError?: { message: string } | null;
  insertedId?: string | null;
  insertError?: { message: string } | null;
} = {}): AccountClient {
  return {
    from: (_table: string) => ({
      select: (..._args: unknown[]) =>
        makeChain({ data: existingId ? { id: existingId } : null, error: selectError }),
      insert: (_data: unknown) => ({
        select: (..._args: unknown[]) =>
          makeChain({ data: insertedId ? { id: insertedId } : null, error: insertError }),
      }),
    }),
  };
}

describe('ensureChequingAccount', () => {
  it('returns the existing chequing account id without inserting', async () => {
    const supabase = makeSupabase({ existingId: 'acc-1' });
    const result = await ensureChequingAccount(supabase, 'hh1');
    expect(result).toEqual({ id: 'acc-1', created: false });
  });

  it('creates a chequing account when none exists, using the trigger defaults', async () => {
    const supabase = makeSupabase({ existingId: null, insertedId: 'acc-new' });
    const result = await ensureChequingAccount(supabase, 'hh1');
    expect(result).toEqual({ id: 'acc-new', created: true });
  });

  it('inserts with exactly household_id, name "Chequing", type "chequing"', async () => {
    let insertedRow: unknown = null;
    const supabase: AccountClient = {
      from: () => ({
        select: () => makeChain({ data: null, error: null }),
        insert: (data: unknown) => {
          insertedRow = data;
          return { select: () => makeChain({ data: { id: 'acc-new' }, error: null }) };
        },
      }),
    };
    await ensureChequingAccount(supabase, 'hh42');
    expect(insertedRow).toEqual({ household_id: 'hh42', name: 'Chequing', type: 'chequing' });
  });

  it('throws when the existence check fails, instead of silently creating a duplicate', async () => {
    const supabase = makeSupabase({ selectError: { message: 'connection lost' } });
    await expect(ensureChequingAccount(supabase, 'hh1')).rejects.toThrow('connection lost');
  });

  it('throws when the insert fails', async () => {
    const supabase = makeSupabase({ existingId: null, insertError: { message: 'constraint violation' } });
    await expect(ensureChequingAccount(supabase, 'hh1')).rejects.toThrow('constraint violation');
  });
});
