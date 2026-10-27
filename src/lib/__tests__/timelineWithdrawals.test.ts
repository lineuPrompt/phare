import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { markWithdrawals } from '../timelineLedger';
import type { TimelineTx } from '../timelineHelpers';

/**
 * markWithdrawals (2026-10-27): a draw on the Timeline is tagged as a
 * withdrawal when its other side is a savings-type account, so the household's
 * own savings never wear the borrowed-money alarm. The source is the peer
 * row's account type — the same rule computeMonthTotals uses.
 */

type Rows = Record<string, Record<string, unknown>[]>;

function fakeSupabase(rows: Rows, failOn?: string) {
  return {
    from(table: string) {
      let result = rows[table] ?? [];
      const api = {
        select() { return api; },
        eq(field: string, value: unknown) { result = result.filter((r) => r[field] === value); return api; },
        in(field: string, values: unknown[]) { result = result.filter((r) => values.includes(r[field])); return api; },
        then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
          return Promise.resolve(
            failOn === table ? { data: null, error: { message: 'boom' } } : { data: result, error: null }
          ).then(resolve);
        },
      };
      return api;
    },
  } as unknown as SupabaseClient;
}

const base = {
  description: null, recurringItemId: null, recurrenceId: null, installmentLabel: null,
  isBridge: false, bridgeSourceAccount: null, bridgeSourceMonth: null,
};
const draw = (id: string, peer: string | null): TimelineTx =>
  ({ ...base, id, date: '2026-07-05', amount: -200, type: 'transfer', transferPeerId: peer });

const ROWS: Rows = {
  transactions: [
    { id: 'peer-sav', account_id: 'acc-sav', household_id: 'hh' },
    { id: 'peer-debt', account_id: 'acc-loc', household_id: 'hh' },
    { id: 'peer-tfsa', account_id: 'acc-tfsa', household_id: 'hh' },
  ],
  accounts: [
    { id: 'acc-sav', type: 'savings', household_id: 'hh' },
    { id: 'acc-loc', type: 'debt', household_id: 'hh' },
    { id: 'acc-tfsa', type: 'tfsa', household_id: 'hh' },
  ],
};

describe('markWithdrawals', () => {
  it('tags a draw from savings or TFSA, leaves a debt draw and a lost peer as plain draws', async () => {
    const out = await markWithdrawals(fakeSupabase(ROWS), 'hh', [
      draw('d-sav', 'peer-sav'),
      draw('d-debt', 'peer-debt'),
      draw('d-tfsa', 'peer-tfsa'),
      draw('d-lost', 'peer-gone'),
      draw('d-none', null),
    ]);
    expect(out.map((t) => [t.id, t.isWithdrawal === true])).toEqual([
      ['d-sav', true],
      ['d-debt', false],
      ['d-tfsa', true],
      ['d-lost', false],
      ['d-none', false],
    ]);
  });

  it('never tags a contribution, even one to savings', async () => {
    const contribution: TimelineTx = { ...draw('c', 'peer-sav'), amount: 200 };
    const [out] = await markWithdrawals(fakeSupabase(ROWS), 'hh', [contribution]);
    expect(out.isWithdrawal).toBeUndefined();
  });

  it('reads only its own household', async () => {
    const out = await markWithdrawals(fakeSupabase(ROWS), 'other-household', [draw('d-sav', 'peer-sav')]);
    expect(out[0].isWithdrawal).toBeUndefined();
  });

  it('a peer row from another household is never read, even when it names this household’s account', async () => {
    // Each query must be scoped on its own: the accounts filter alone would
    // not stop this one.
    const rows: Rows = {
      transactions: [{ id: 'peer-foreign', account_id: 'acc-sav', household_id: 'other-household' }],
      accounts: ROWS.accounts,
    };
    const [out] = await markWithdrawals(fakeSupabase(rows), 'hh', [draw('d', 'peer-foreign')]);
    expect(out.isWithdrawal).toBeUndefined();
  });

  it.each(['transactions', 'accounts'])('a failed %s read throws instead of guessing', async (table) => {
    await expect(markWithdrawals(fakeSupabase(ROWS, table), 'hh', [draw('d-sav', 'peer-sav')])).rejects.toThrow(/read failed: boom/);
  });
});
