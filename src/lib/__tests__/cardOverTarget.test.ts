import { describe, it, expect } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, type Row } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';
import { overTargetCategoriesForCycle } from '@/lib/cardOverTarget';
import type { EnvTx } from '@/lib/envelopeHelpers';

/**
 * THE REVIEW JUDGES THE REVIEWED MONTH'S CYCLE, AGAINST THE PLAN THE
 * HOUSEHOLD SEES.
 *
 * 2026-09-29: the plan is the Cards page's (carried forward when the cycle
 * has none of its own).
 * 2026-10-10: the cycle is the one labelled with the reviewed month, not the
 * one containing today. The scheduled review runs on the 1st, when the cycle
 * containing today is a few days old.
 *
 * The card closes on the 15th: cycle 2026-09 is Aug 16 – Sep 15, cycle
 * 2026-10 is Sep 16 – Oct 15. August's plan (Groceries $500, Restaurants
 * $150) carries into both.
 */

const CARD = 'card-master';
const GROCERIES = 'cat-groceries';
const RESTAURANTS = 'cat-restaurants';
const CARDS = [{ id: CARD, statement_close_day: 15 }];

function seed(extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    households: [FREE_HOUSEHOLD],
    monthly_goals: [{ household_id: 'hh-1', account_id: CARD, month: '2026-08-01', card_goal: 900 }],
    card_envelope_items: [
      { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-08-01', monthly_amount: 500, categories: { name: 'Groceries & Pharmacy', name_fr: 'Épicerie et pharmacie' } },
      { household_id: 'hh-1', account_id: CARD, category_id: RESTAURANTS, month: '2026-08-01', monthly_amount: 150, categories: { name: 'Restaurants', name_fr: 'Restaurants' } },
    ],
    ...extra,
  };
}

const spend = (date: string, amount: number, category: string): EnvTx =>
  ({ account_id: CARD, date, amount, type: 'expense', category_id: category, is_bridge: false });

async function check(
  history: EnvTx[],
  cycleMonth: string,
  today: string,
  store = seed(),
  opts: { failTables?: string[] } = {}
) {
  const { client } = makeFakeCardSupabase(store, opts);
  return overTargetCategoriesForCycle(client as never, 'hh-1', CARDS, history, cycleMonth, today);
}

describe('overTargetCategoriesForCycle — the reviewed month\'s cycle', () => {
  it('the 1st-of-month run for September judges September\'s cycle, not the live one', async () => {
    // Run on Oct 1. The live cycle (Sep 16 – Oct 15) holds $40; September's
    // cycle (Aug 16 – Sep 15) holds $620 of groceries against $500.
    // September's cycle is closed on Oct 1, so it is judged against its OWN
    // plan (closed plans are never carried) — saved here at $500.
    const store = seed({
      card_envelope_items: [
        { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-09-01', monthly_amount: 500, categories: { name: 'Groceries & Pharmacy', name_fr: null } },
        // October's own plan is generous: judged against the live cycle, $40 of
        // groceries would never be over anything anyway.
        { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-10-01', monthly_amount: 30, categories: { name: 'Groceries & Pharmacy', name_fr: null } },
      ],
    });
    const history = [spend('2026-09-10', 620, GROCERIES), spend('2026-09-30', 40, GROCERIES)];
    expect(await check(history, '2026-09', '2026-10-01', store)).toEqual([
      { categoryName: 'Groceries & Pharmacy', target: 500, actual: 620, over: 120, open: false },
    ]);
  });

  it('within the plan: nothing over target', async () => {
    expect(await check([spend('2026-09-01', 450, GROCERIES), spend('2026-09-02', 100, RESTAURANTS)], '2026-09', '2026-10-01')).toEqual([]);
  });

  it('spend outside the reviewed cycle window does not count', async () => {
    // Aug 15 belongs to August's cycle; Sep 16 to October's.
    expect(await check([spend('2026-08-15', 900, GROCERIES), spend('2026-09-16', 900, GROCERIES)], '2026-09', '2026-10-01')).toEqual([]);
  });

  it('a cycle still open is reported, and marked open', async () => {
    // A manual refresh on Sep 29 reviews September... and card cycle 2026-10
    // when that is the month asked for: open until Oct 15.
    expect(await check([spend('2026-09-20', 450, GROCERIES), spend('2026-09-27', 170, GROCERIES)], '2026-10', '2026-09-29')).toEqual([
      { categoryName: 'Groceries & Pharmacy', target: 500, actual: 620, over: 120, open: true },
    ]);
  });

  it('a closed cycle with no plan of its own is judged against nothing (closed plans are never carried)', async () => {
    // September is closed on Oct 1 and has no plan rows of its own.
    const store = seed({ card_envelope_items: [], monthly_goals: [] });
    expect(await check([spend('2026-09-10', 620, GROCERIES)], '2026-09', '2026-10-01', store)).toEqual([]);
  });

  it('the cycle\'s OWN plan outranks the carried one', async () => {
    const store = seed({
      card_envelope_items: [
        ...seed().card_envelope_items,
        { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-10-01', monthly_amount: 700, categories: { name: 'Groceries & Pharmacy', name_fr: null } },
      ],
    });
    // $620 is over August's $500 but within October's own $700.
    expect(await check([spend('2026-09-20', 620, GROCERIES)], '2026-10', '2026-09-29', store)).toEqual([]);
  });

  it('a budget of 0 is not a target — the Cards page\'s rule (envelopeStatus "unset")', async () => {
    const store = seed({
      card_envelope_items: [
        { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-09-01', monthly_amount: 0, categories: { name: 'Groceries & Pharmacy', name_fr: null } },
      ],
    });
    expect(await check([spend('2026-09-10', 1703.1, GROCERIES)], '2026-09', '2026-10-01', store)).toEqual([]);
  });

  it('a failed plan read throws — never "no targets"', async () => {
    await expect(check([spend('2026-09-10', 620, GROCERIES)], '2026-09', '2026-10-01', seed(), { failTables: ['card_envelope_items'] }))
      .rejects.toThrow(/card_envelope_items read failed/);
  });
});
