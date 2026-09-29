import { describe, it, expect } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, type Row } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';
import { overTargetCategoriesForLiveCycles } from '@/lib/cardOverTarget';
import type { EnvTx } from '@/lib/envelopeHelpers';

/**
 * THE REVIEW JUDGES AGAINST THE PLAN THE HOUSEHOLD SEES (2026-09-29).
 *
 * The over-target check used to read the live cycle month's own category
 * rows only. A live cycle with no plan of its own — carried forward on the
 * Cards page — had no targets, so the review reported nothing over target
 * however far past the carried plan the spending was.
 *
 * Today is Sep 29 2026; the card closes on the 15th, so the live cycle is
 * October (Sep 16 – Oct 15), which has no plan of its own. August's plan
 * (Groceries $500, Restaurants $150) carries into it.
 */

const CARD = 'card-master';
const GROCERIES = 'cat-groceries';
const RESTAURANTS = 'cat-restaurants';
const TODAY = '2026-09-29';
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

async function check(history: EnvTx[], store = seed(), opts: { failTables?: string[] } = {}) {
  const { client } = makeFakeCardSupabase(store, opts);
  return overTargetCategoriesForLiveCycles(client as never, 'hh-1', CARDS, history, TODAY);
}

describe('overTargetCategoriesForLiveCycles — the live cycle carried forward', () => {
  it('within the carried plan: nothing over target', async () => {
    expect(await check([spend('2026-09-20', 450, GROCERIES), spend('2026-09-22', 100, RESTAURANTS)])).toEqual([]);
  });

  it('over the CARRIED Groceries budget: reported, against the carried $500', async () => {
    const result = await check([spend('2026-09-20', 450, GROCERIES), spend('2026-09-27', 170, GROCERIES)]);
    expect(result).toEqual([{ categoryName: 'Groceries & Pharmacy', target: 500, actual: 620, over: 120 }]);
  });

  it('spend outside the live cycle window does not count', async () => {
    // Sep 15 belongs to September's (closed) cycle; Oct 16 to November's.
    expect(await check([spend('2026-09-15', 900, GROCERIES), spend('2026-10-16', 900, GROCERIES)])).toEqual([]);
  });

  it('the live cycle\'s OWN plan outranks the carried one', async () => {
    const store = seed({
      card_envelope_items: [
        ...seed().card_envelope_items,
        { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-10-01', monthly_amount: 700, categories: { name: 'Groceries & Pharmacy', name_fr: null } },
      ],
    });
    // $620 is over August's $500 but within October's own $700.
    expect(await check([spend('2026-09-20', 620, GROCERIES)], store)).toEqual([]);
  });

  it('a failed plan read throws — never "no targets"', async () => {
    await expect(check([spend('2026-09-20', 620, GROCERIES)], seed(), { failTables: ['card_envelope_items'] }))
      .rejects.toThrow(/card_envelope_items read failed/);
  });
});
