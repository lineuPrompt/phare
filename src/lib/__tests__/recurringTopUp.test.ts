import { describe, it, expect, vi } from 'vitest';
import { makeFakeCardSupabase, type Row } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';
import { topUpRecurringRules } from '@/lib/recurringTopUp';

const HH = 'hh-1';
const TODAY = '2026-12-01'; // window: December 2026 through November 2027

const rule = (id: string, extra: Row = {}): Row => ({
  id, household_id: HH, type: 'expense', cadence: 'monthly', anchor_date: '2026-10-05', second_day: null,
  effective_from: null, member_id: 'm-1', category_id: 'cat-1', account_id: 'chq', destination_account_id: null,
  description: `Bill ${id}`, amount: 100, active: true, ...extra,
});
const row = (ruleId: string, date: string, household_id = HH): Row =>
  ({ id: `${ruleId}-${date}`, household_id, recurring_item_id: ruleId, date, amount: 100, type: 'expense' });

function run(seed: Record<string, Row[]>) {
  const fake = makeFakeCardSupabase({ recurring_skipped_dates: [], ...seed });
  const rpc = vi.fn(async () => ({ error: null as { message: string } | null }));
  (fake.client as unknown as { rpc: typeof rpc }).rpc = rpc;
  return { fake, rpc, go: () => topUpRecurringRules(fake.client as never, HH, TODAY) };
}

const inserted = (fake: ReturnType<typeof makeFakeCardSupabase>) =>
  fake.writes.filter((w) => w.op === 'insert' && w.table === 'transactions').flatMap((w) => w.payload as Row[]);

describe('topUpRecurringRules', () => {
  it('continues a rule after its last row, as POST writes it, expense with no member', async () => {
    const { fake, go } = run({ recurring_items: [rule('r1')], transactions: [row('r1', '2027-09-05')] });
    expect(await go()).toEqual({ rules: 1, topped: 1, inserted: 2, errors: [] });
    expect(inserted(fake)).toEqual(['2027-10-05', '2027-11-05'].map((date) => ({
      household_id: HH, member_id: null, category_id: 'cat-1', account_id: 'chq', amount: 100,
      description: 'Bill r1', date, type: 'expense', source: 'manual', recurring_item_id: 'r1',
    })));
  });

  it('a second run the same day writes nothing', async () => {
    const { fake, go } = run({ recurring_items: [rule('r1')], transactions: [row('r1', '2027-09-05')] });
    await go();
    expect((await go()).inserted).toBe(0);
    expect(inserted(fake)).toHaveLength(2);
  });

  it('a later tombstone (an occurrence deleted or edited alone) is never written back', async () => {
    const { fake, go } = run({
      recurring_items: [rule('r1')],
      transactions: [row('r1', '2027-09-05')],
      recurring_skipped_dates: [{ household_id: HH, recurring_item_id: 'r1', date: '2027-10-05' }],
    });
    await go();
    expect(inserted(fake).map((r) => r.date)).toEqual(['2027-11-05']);
  });

  it('income keeps its member; another household\'s later row is not this rule\'s', async () => {
    const { fake, go } = run({
      recurring_items: [rule('r1', { type: 'income' })],
      transactions: [row('r1', '2027-09-05'), row('r1', '2027-11-05', 'other')],
    });
    await go();
    expect(inserted(fake).map((r) => [r.date, r.member_id])).toEqual([['2027-10-05', 'm-1'], ['2027-11-05', 'm-1']]);
  });

  it('left alone: inactive (split) rules, rules with no pay date, rules with no row and no tombstone', async () => {
    const { fake, go } = run({
      recurring_items: [rule('a', { active: false }), rule('b', { anchor_date: null }), rule('c')],
      transactions: [row('a', '2027-09-05'), row('b', '2027-09-05')],
    });
    expect(await go()).toEqual({ rules: 1, topped: 0, inserted: 0, errors: [] });
    expect(inserted(fake)).toEqual([]);
  });

  it('never past the end date', async () => {
    const { fake, go } = run({ recurring_items: [rule('r1', { end_date: '2027-10-31' })], transactions: [row('r1', '2027-09-05')] });
    await go();
    expect(inserted(fake).map((r) => r.date)).toEqual(['2027-10-05']);
  });

  it('a transfer goes through create_transfer, one date at a time, with the rule\'s member', async () => {
    const { rpc, go } = run({
      recurring_items: [rule('t1', { type: 'transfer', category_id: null, destination_account_id: 'goal' })],
      transactions: [row('t1', '2027-09-05')],
    });
    expect((await go()).inserted).toBe(2);
    expect(rpc.mock.calls.map((c) => (c as unknown as [string, Record<string, unknown>])[1])).toEqual(['2027-10-05', '2027-11-05'].map((p_date) => ({
      p_household_id: HH, p_member_id: 'm-1', p_chequing_id: 'chq', p_goal_id: 'goal', p_amount: 100,
      p_date, p_description: 'Bill t1', p_recurring_item_id: 't1',
    })));
  });

  it('one rule that cannot be continued is reported, and the others still are', async () => {
    const { fake, go } = run({
      recurring_items: [rule('t1', { type: 'transfer', member_id: null, destination_account_id: 'goal' }), rule('r2')],
      transactions: [row('t1', '2027-09-05'), row('r2', '2027-09-05')],
    });
    const result = await go();
    expect(result.errors).toEqual(['transfer rule t1 has no member or no destination; not continued']);
    expect(inserted(fake).map((r) => r.recurring_item_id)).toEqual(['r2', 'r2']);
  });

  it('a failed read is reported, never taken as "nothing to do"', async () => {
    const fake = makeFakeCardSupabase({ recurring_items: [rule('r1')] }, { failTables: ['recurring_items'] });
    await expect(topUpRecurringRules(fake.client as never, HH, TODAY)).rejects.toThrow(/recurring_items read failed/);
  });
});
