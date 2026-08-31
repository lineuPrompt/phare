/**
 * setOpeningBalance — the upsert-in-place behaviour, exercised against a
 * mutable in-memory fake (same approach as the recurring split tests).
 *
 * These exist because mutation testing found four assertions that nothing
 * was making: appending instead of updating, never removing on zero/null,
 * and finding the row by description instead of the flag all passed a green
 * suite. Each mutant now has a test that fails on it.
 *
 * The distinction being defended: an opening balance is a STATED STARTING
 * POSITION. Correcting it must change the one row, never append a second —
 * appending would invent a movement on a date when nothing moved, which is
 * exactly what the debt 'Balance correction' path does deliberately and
 * this path must not.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setOpeningBalance, OPENING_BALANCE_DESCRIPTION } from '../openingBalance';

type Row = Record<string, unknown> & { id: string };
type Filter = { field: string; value: unknown };

const HH = 'hh-1';
const ACCT = 'acct-goal';

function makeFakeSupabase(seed: Row[]) {
  let rows: Row[] = seed.map((r) => ({ ...r }));
  let idCounter = 1;
  const calls: { op: string; filters: Filter[] }[] = [];

  const match = (r: Row, filters: Filter[]) => filters.every((f) => r[f.field] === f.value);

  function from(table: string) {
    if (table !== 'transactions') throw new Error(`unexpected table ${table}`);
    return {
      select() {
        const filters: Filter[] = [];
        const api = {
          eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
          maybeSingle() {
            calls.push({ op: 'select', filters: [...filters] });
            const found = rows.filter((r) => match(r, filters));
            return Promise.resolve({ data: found[0] ? { ...found[0] } : null, error: null });
          },
        };
        return api;
      },
      update(patch: Record<string, unknown>) {
        const filters: Filter[] = [];
        const api = {
          eq(field: string, value: unknown) {
            filters.push({ field, value });
            // Terminal on the last eq — the helper always ends with two.
            if (filters.length === 2) {
              calls.push({ op: 'update', filters: [...filters] });
              rows = rows.map((r) => (match(r, filters) ? { ...r, ...patch } : r));
              return Promise.resolve({ error: null });
            }
            return api;
          },
        };
        return api;
      },
      delete() {
        const filters: Filter[] = [];
        const api = {
          eq(field: string, value: unknown) {
            filters.push({ field, value });
            if (filters.length === 2) {
              calls.push({ op: 'delete', filters: [...filters] });
              rows = rows.filter((r) => !match(r, filters));
              return Promise.resolve({ error: null });
            }
            return api;
          },
        };
        return api;
      },
      insert(row: Record<string, unknown>) {
        calls.push({ op: 'insert', filters: [] });
        rows.push({ id: `new-${idCounter++}`, ...row } as Row);
        return Promise.resolve({ error: null });
      },
    };
  }

  return { client: { from } as never, all: () => rows, calls };
}

const existingRow: Row = {
  id: 'ob-1',
  household_id: HH,
  account_id: ACCT,
  amount: 500,
  date: '2026-07-01',
  type: 'transfer',
  description: OPENING_BALANCE_DESCRIPTION,
  is_opening_balance: true,
};

describe('setOpeningBalance', () => {
  let fake: ReturnType<typeof makeFakeSupabase>;

  describe('when none exists yet', () => {
    beforeEach(() => { fake = makeFakeSupabase([]); });

    it('inserts one row, flagged, as a one-sided transfer', async () => {
      const err = await setOpeningBalance(fake.client, HH, ACCT, 500, '2026-08-31');
      expect(err).toBeNull();
      expect(fake.all()).toHaveLength(1);
      expect(fake.all()[0]).toMatchObject({
        household_id: HH,
        account_id: ACCT,
        amount: 500,
        date: '2026-08-31',
        type: 'transfer',
        is_opening_balance: true,
      });
      // No chequing peer — that is what keeps it off the Timeline.
      expect(fake.all()[0].transfer_peer_id).toBeUndefined();
    });

    it('writes nothing at all when asked for zero or null', async () => {
      expect(await setOpeningBalance(fake.client, HH, ACCT, 0, '2026-08-31')).toBeNull();
      expect(await setOpeningBalance(fake.client, HH, ACCT, null, '2026-08-31')).toBeNull();
      expect(fake.all()).toHaveLength(0);
    });
  });

  describe('when one already exists', () => {
    beforeEach(() => { fake = makeFakeSupabase([existingRow]); });

    it('UPDATES IN PLACE — never appends a second row', async () => {
      await setOpeningBalance(fake.client, HH, ACCT, 800, '2026-08-31');
      expect(fake.all()).toHaveLength(1);
      expect(fake.all()[0].id).toBe('ob-1');
      expect(fake.all()[0].amount).toBe(800);
      expect(fake.calls.some((c) => c.op === 'insert')).toBe(false);
    });

    it('REMOVES it when set to zero, and to null', async () => {
      await setOpeningBalance(fake.client, HH, ACCT, 0, '2026-08-31');
      expect(fake.all()).toHaveLength(0);

      fake = makeFakeSupabase([existingRow]);
      await setOpeningBalance(fake.client, HH, ACCT, null, '2026-08-31');
      expect(fake.all()).toHaveLength(0);
    });

    it('FINDS THE ROW BY THE FLAG, never by description', async () => {
      // The description is user-editable from the goal's history list. A
      // household that renamed it must still be able to change the amount.
      const renamed = makeFakeSupabase([{ ...existingRow, description: 'my own words' }]);
      await setOpeningBalance(renamed.client, HH, ACCT, 900, '2026-08-31');
      expect(renamed.all()).toHaveLength(1);
      expect(renamed.all()[0].amount).toBe(900);
      expect(renamed.all()[0].description).toBe('my own words'); // wording preserved

      // And the lookup itself must filter on the flag.
      const lookup = renamed.calls.find((c) => c.op === 'select')!;
      expect(lookup.filters).toContainEqual({ field: 'is_opening_balance', value: true });
      expect(lookup.filters.map((f) => f.field)).not.toContain('description');
    });

    it('scopes every write by household as well as account', async () => {
      await setOpeningBalance(fake.client, HH, ACCT, 800, '2026-08-31');
      const write = fake.calls.find((c) => c.op === 'update')!;
      expect(write.filters).toContainEqual({ field: 'household_id', value: HH });
    });
  });
});
