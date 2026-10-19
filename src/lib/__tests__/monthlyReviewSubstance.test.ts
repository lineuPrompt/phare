import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Guard events are written through the service role (eventWriter, launch plan
// 1.1), not the fake session: read them from the suite-wide recorder.
import { recordedEvents } from '../../test/eventWriterDouble';
import { makeFakeCardSupabase, type Row } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';
import { monthReachedByRules } from '@/lib/goalHelpers';
import { cardLetterFacts } from '@/lib/cardOverTarget';

// ---------------------------------------------------------------------------
// MONTHLY REVIEW — SUBSTANCE (Part B, 2026-10-10).
//
// The letter's payload now carries what the household's month actually was:
// each card's reviewed cycle (goal, spent, top overspends, the cycle before),
// the month's surplus and where its savings went, the month before, the month
// ahead's lowest balance, and goal and reserve progress at the household's
// OWN contributions. Every figure comes from the helpers the app's own screens
// use; the first describe proves the cards' figures equal what the Cards page
// routes return for the same data, to the cent.
//
// The fake honours eq / in / gte / lte / lt, so each query gets only the rows
// a real database would return.
// ---------------------------------------------------------------------------

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => createMock(...a) } },
}));
vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const HH = 'hh-1';
const CHQ = 'chq';
const VISA = 'visa';
const COSTCO = 'costco';
const TRAVEL = 'goal-travel';
const BUFFER = 'buffer';
const C = { shopping: 'cat-shop', unexpected: 'cat-unexp', groceries: 'cat-groc', restaurants: 'cat-rest' };
const CAT_NAMES: Record<string, string> = {
  [C.shopping]: 'Shopping', [C.unexpected]: 'Unexpected', [C.groceries]: 'Groceries & Pharmacy', [C.restaurants]: 'Restaurants',
};

let n = 0;
const tx = (account_id: string, date: string, amount: number, type: string, extra: Row = {}): Row =>
  ({ id: `t${++n}`, household_id: HH, account_id, date, amount, type, transfer_peer_id: null, recurring_item_id: null, description: null, category_id: null, is_bridge: false, installment_label: null, recurrence_id: null, ...extra });
const spend = (card: string, date: string, amount: number, cat: string) => tx(card, date, amount, 'expense', { category_id: cat });
function transfer(to: string, date: string, amount: number): Row[] {
  const out = `x${++n}`; const into = `x${++n}`;
  return [
    tx(CHQ, date, amount, 'transfer', { id: out, transfer_peer_id: into }),
    tx(to, date, amount, 'transfer', { id: into, transfer_peer_id: out }),
  ];
}
const plan = (category: string, amount: number): Row => ({
  household_id: HH, account_id: VISA, category_id: category, month: '2026-09-01', monthly_amount: amount,
  categories: { name: CAT_NAMES[category], name_fr: null },
});

function seed(): Record<string, Row[]> {
  n = 0;
  return {
    users: [{ id: 'user-1', household_id: HH }],
    households: [{ id: HH, timezone: 'America/Toronto', subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', subscription_cancel_at_period_end: false, comp_until: null }],
    accounts: [
      { id: CHQ, household_id: HH, name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, is_sinking_fund: false, statement_close_day: null, payment_day: null, sort_order: 0, created_at: '2026-07-01' },
      { id: VISA, household_id: HH, name: 'Visa Avion', type: 'credit_card', goal_target: null, goal_target_date: null, is_sinking_fund: false, statement_close_day: 27, payment_day: 10, sort_order: 1, created_at: '2026-07-01' },
      { id: COSTCO, household_id: HH, name: 'Costco Julia', type: 'credit_card', goal_target: null, goal_target_date: null, is_sinking_fund: false, statement_close_day: 15, payment_day: 3, sort_order: 2, created_at: '2026-07-02' },
      { id: TRAVEL, household_id: HH, name: 'Travel', type: 'savings', goal_target: 13000, goal_target_date: '2028-12-28', is_sinking_fund: false, statement_close_day: null, payment_day: null, sort_order: 3, created_at: '2026-07-03' },
      { id: BUFFER, household_id: HH, name: 'Sinking funds', type: 'savings', goal_target: null, goal_target_date: null, is_sinking_fund: true, statement_close_day: null, payment_day: null, sort_order: 4, created_at: '2026-07-04' },
    ],
    categories: Object.entries(CAT_NAMES).map(([id, name]) => ({ id, household_id: HH, type: 'expense', name, name_fr: null })),
    monthly_goals: [{ household_id: HH, account_id: VISA, month: '2026-09-01', card_goal: 3000 }],
    card_envelope_items: [plan(C.shopping, 350), plan(C.unexpected, 1115), plan(C.groceries, 200), plan(C.restaurants, 735)],
    sinking_funds: [
      { household_id: HH, name: 'Property tax', annual_amount: 3106.2, monthly_provision: 258.85, due_month: 3, due_day: null, linked_account_id: BUFFER, active: true },
      { household_id: HH, name: 'Income tax', annual_amount: 2000, monthly_provision: 166.67, due_month: 4, due_day: null, linked_account_id: BUFFER, active: true },
    ],
    recurring_items: [
      { id: 'r-travel', household_id: HH, type: 'transfer', active: true, amount: 125, cadence: 'biweekly', anchor_date: '2026-09-12', second_day: null, effective_from: null, destination_account_id: TRAVEL, accounts: { name: 'Travel', type: 'savings' } },
      { id: 'r-buffer', household_id: HH, type: 'transfer', active: true, amount: 425.52, cadence: 'monthly', anchor_date: '2026-08-30', second_day: null, effective_from: null, destination_account_id: BUFFER, accounts: { name: 'Sinking funds', type: 'savings' } },
    ],
    account_balance_anchors: [{ household_id: HH, account_id: CHQ, anchor_date: '2026-09-01', balance: 1000 }],
    transactions: [
      // Visa, September's cycle (Aug 28 – Sep 27): goal 3000.
      spend(VISA, '2026-09-02', 789.09, C.shopping),
      spend(VISA, '2026-09-05', 1366.96, C.unexpected),
      spend(VISA, '2026-09-10', 422.16, C.groceries),
      spend(VISA, '2026-09-20', 793.75, C.restaurants),
      // Visa, August's cycle (Jul 28 – Aug 27).
      spend(VISA, '2026-08-02', 545.49, C.shopping),
      spend(VISA, '2026-08-05', 190.33, C.unexpected),
      spend(VISA, '2026-08-10', 1191.69, C.groceries),
      // Costco, September's cycle (Aug 16 – Sep 15), no plan; August's (Jul 16 – Aug 15).
      spend(COSTCO, '2026-09-01', 1933.12, C.unexpected),
      spend(COSTCO, '2026-08-01', 449.6, C.unexpected),
      // Chequing: August and September, and October as dated.
      tx(CHQ, '2026-08-02', 5000, 'income', { description: 'Salary' }),
      tx(CHQ, '2026-08-03', 4000, 'expense', { description: 'Mortgage' }),
      ...transfer(BUFFER, '2026-08-30', 425.52),
      tx(CHQ, '2026-09-02', 5000, 'income', { description: 'Salary' }),
      tx(CHQ, '2026-09-03', 4500, 'expense', { description: 'Mortgage' }),
      ...transfer(TRAVEL, '2026-09-12', 125),
      tx(CHQ, '2026-10-05', 4200, 'expense', { description: 'Mortgage' }),
      tx(CHQ, '2026-10-15', 3000, 'income', { description: 'Salary' }),
    ],
    events: [],
  };
}

function aiReturns(text: string) {
  return { content: [{ type: 'text', text }] };
}

async function generate(reviewMonth = '2026-09', reviewText = 'September was steady.', retryText?: string) {
  createMock.mockReset();
  createMock
    .mockResolvedValueOnce(aiReturns(JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' })))
    .mockResolvedValueOnce(aiReturns(reviewText));
  if (retryText !== undefined) createMock.mockResolvedValueOnce(aiReturns(retryText));
  const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
  const fake = makeFakeCardSupabase(seed());
  let error: unknown = null;
  let result: { reviewText: string } | null = null;
  try {
    result = await generateMonthlyReview({
      supabase: fake.client as never, householdId: HH, locale: 'en', timezone: 'America/Toronto', reviewMonth, userId: 'user-1',
    });
  } catch (e) { error = e; }
  const prompt = createMock.mock.calls[1][0].messages[0].content as string;
  const json = prompt.slice(prompt.indexOf('Their plan:\n') + 'Their plan:\n'.length, prompt.indexOf('\n\nWrite '));
  return { payload: JSON.parse(json), prompt, fake, error, result };
}

async function cardsRoute() {
  const { client } = makeFakeCardSupabase(seed());
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

describe('monthly review — Part B substance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00-04:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  describe('one source of truth: the cards equal what the Cards page routes return', () => {
    it('goal and spent per card equal GET /api/cards/overview for the reviewed cycle, to the cent', async () => {
      const { payload } = await generate();
      await cardsRoute();
      const { GET } = await import('@/app/api/cards/overview/route');
      const overview = await (await GET(new Request('http://localhost/api/cards/overview?month=2026-09'))).json();
      // Compared by card, not by position: the overview lists cards in their
      // display order, the review in account order.
      const byName = (cards: { name: string; goal: number | null; spent: number }[]) =>
        cards.map((c) => [c.name, c.goal, c.spent]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
      expect(byName(payload.cards)).toEqual(byName(overview.cards));
      expect(byName(overview.cards)).toEqual([['Costco Julia', null, 1933.12], ['Visa Avion', 3000, 3371.96]]);
    });

    it('each top overspend equals the Cards page decision view\'s row: plan, actual, and the amount over', async () => {
      const { payload } = await generate();
      await cardsRoute();
      const { GET } = await import('@/app/api/card-envelope/route');
      const envelope = await (await GET(new Request(`http://localhost/api/card-envelope?cardId=${VISA}&month=2026-09`))).json();
      const visa = payload.cards.find((c: { name: string }) => c.name === 'Visa Avion');
      for (const o of visa.topOverspends) {
        const row = envelope.envelopeItems.find((i: { categoryName: string }) => i.categoryName === o.category);
        expect(row.status).toBe('over');
        expect([o.plan, o.actual, o.over]).toEqual([row.monthlyAmount, row.actual, -row.remaining]);
      }
      expect(visa.spent).toBe(envelope.totalSpent);
      expect(visa.goal).toBe(envelope.totalGoal);
    });
  });

  describe('per card: the reviewed cycle against its goal, and the cycle before', () => {
    it('top three overspends, largest first, with the previous cycle and the change', async () => {
      const { payload } = await generate();
      const visa = payload.cards.find((c: { name: string }) => c.name === 'Visa Avion');
      expect(visa).toMatchObject({ cycleStart: '2026-08-28', cycleEnd: '2026-09-27', open: false, goal: 3000, spent: 3371.96, overGoalBy: 371.96, previousCycleSpent: 1927.51, spentChange: 1444.45 });
      expect(visa.topOverspends).toEqual([
        { category: 'Shopping', plan: 350, actual: 789.09, over: 439.09, previousActual: 545.49, change: 243.6 },
        { category: 'Unexpected', plan: 1115, actual: 1366.96, over: 251.96, previousActual: 190.33, change: 1176.63 },
        { category: 'Groceries & Pharmacy', plan: 200, actual: 422.16, over: 222.16, previousActual: 1191.69, change: -769.53 },
      ]);
    });

    it('a card with no goal has goal null and no overGoalBy — never 0', async () => {
      const { payload } = await generate();
      const costco = payload.cards.find((c: { name: string }) => c.name === 'Costco Julia');
      expect(costco).toMatchObject({ goal: null, spent: 1933.12, previousCycleSpent: 449.6, spentChange: 1483.52, topOverspends: [] });
      expect(costco).not.toHaveProperty('overGoalBy');
    });

    it('a manual refresh of the current month marks open cycles open, and the prompt says what open means', async () => {
      // Regenerate reviews the CURRENT month: October, on Oct 1. Visa's
      // October cycle (Sep 28 – Oct 27) is open.
      const { payload, prompt } = await generate('2026-10');
      expect(payload.cards.find((c: { name: string }) => c.name === 'Visa Avion').open).toBe(true);
      expect(prompt).toContain('"running ahead of the goal so far", never "over goal"');
      expect(prompt).toContain('- NO PERCENTAGES: never write a percentage');
    });
  });

  describe('the month, its savings, and the month before', () => {
    it('surplus, savings by destination and debt payments, from computeMonthTotals', async () => {
      const { payload } = await generate();
      expect(payload.month).toEqual({ income: 5000, expenses: 4500, savings: 125, debtPayments: 0, borrowed: 0, netCashFlow: 375, result: 'surplus' });
      expect(payload.savingsByDestination).toEqual([{ name: 'Travel', amount: 125 }]);
    });

    it('month over month: expenses and card spend against August', async () => {
      const { payload } = await generate();
      expect(payload.previousMonth).toEqual({
        name: 'August 2026', expenses: 4000, expensesChange: 500,
        cardSpend: 2377.11, cardSpendChange: 2927.97,
      });
    });

    it('lines carry "actual"; the word "budgeted" is gone from the payload', async () => {
      const { payload } = await generate();
      expect(payload.expenseLines).toEqual([{ name: 'Mortgage', actual: 4500, isFixed: false }]);
      expect(payload.incomeLines).toEqual([{ name: 'Salary', actual: 5000 }]);
      expect(JSON.stringify(payload)).not.toContain('budgeted');
    });
  });

  describe('the month ahead, as the Cash Timeline shows it', () => {
    it('its lowest balance, the day, and the first day below zero — card payments included', async () => {
      const { payload } = await generate();
      // From the Sep 1 anchor of 1000: +5000 −4500 −125 = 1375 at Sep 30.
      // Oct 3 Costco's September cycle −1933.12 → −558.12 (first below zero);
      // Oct 5 −4200 → −4758.12; Oct 10 Visa's September cycle −3371.96 →
      // −8130.08 (lowest); Oct 15 +3000.
      expect(payload.monthAhead).toEqual({
        month: '2026-10', lowestBalance: -8130.08, lowestDate: '2026-10-10', anyDayBelowZero: true, firstDayBelowZero: '2026-10-03',
      });
    });

    it('no anchored balance: no month ahead, and nothing written', async () => {
      createMock.mockReset();
      createMock
        .mockResolvedValueOnce(aiReturns(JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' })))
        .mockResolvedValueOnce(aiReturns('September was steady.'));
      const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
      const store = seed();
      store.account_balance_anchors = [];
      const fake = makeFakeCardSupabase(store);
      await generateMonthlyReview({ supabase: fake.client as never, householdId: HH, locale: 'en', timezone: 'America/Toronto', reviewMonth: '2026-09', userId: 'user-1' });
      const prompt = createMock.mock.calls[1][0].messages[0].content as string;
      expect(prompt).toContain('"monthAhead":null');
      expect(fake.writes.filter((w) => w.table === 'transactions')).toEqual([]);
    });
  });

  describe('goal and reserve progress at the household\'s own contributions', () => {
    it('the goal: saved, remaining, and when its own rule reaches the target', async () => {
      const { payload } = await generate();
      const [goal] = payload.goals;
      const reached = monthReachedByRules(13000, 125, [{ amount: 125, cadence: 'biweekly', anchorDate: '2026-09-12', secondDay: null, effectiveFrom: null }], '2026-10-01');
      expect(reached).not.toBeNull();
      expect(goal).toMatchObject({
        savedSoFar: 125, remaining: 12875, contributionRules: [{ amount: 125, cadence: 'biweekly' }], depositedThisMonth: 125,
        reachedAtActualContribution: reached, onTrackAtActualContribution: false,
      });
      expect(goal.reachedAtActualContribution > '2028-12').toBe(true);
      // Months from today (2026-10-01) to that month.
      const [ry, rm] = (reached as string).split('-').map(Number);
      expect(goal.monthsLeftAtActualContribution).toBe((ry - 2026) * 12 + (rm - 10));
    });

    it('the reserve: balance, what landed this month, and the remaining to every fund\'s annual amount', async () => {
      const { payload } = await generate();
      expect(payload.sinkingFundBuffer).toMatchObject({
        fundedAlready: true, balance: 425.52, totalAnnualAmount: 5106.2, remaining: 4680.68,
        contributionRules: [{ amount: 425.52, cadence: 'monthly' }], depositedThisMonth: 0,
      });
      expect(payload.sinkingFundBuffer.reachedAtActualContribution).toMatch(/^\d{4}-\d{2}$/);
    });

    it('no rule, no reach date: the field is left out, never estimated', async () => {
      createMock.mockReset();
      createMock
        .mockResolvedValueOnce(aiReturns(JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' })))
        .mockResolvedValueOnce(aiReturns('September was steady.'));
      const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
      const store = seed();
      store.recurring_items = store.recurring_items.filter((r) => r.id !== 'r-travel');
      await generateMonthlyReview({ supabase: makeFakeCardSupabase(store).client as never, householdId: HH, locale: 'en', timezone: 'America/Toronto', reviewMonth: '2026-09', userId: 'user-1' });
      const prompt = createMock.mock.calls[1][0].messages[0].content as string;
      const payload = JSON.parse(prompt.slice(prompt.indexOf('Their plan:\n') + 12, prompt.indexOf('\n\nWrite ')));
      expect(payload.goals[0]).not.toHaveProperty('reachedAtActualContribution');
      expect(payload.goals[0]).not.toHaveProperty('onTrackAtActualContribution');
      expect(payload.goals[0].remaining).toBe(12875);
    });
  });

  describe('the names guard on a real payload', () => {
    it('naming a card and a category the payload carries passes', async () => {
      const { result, error } = await generate('2026-09', 'Visa Avion ran $371.96 past its goal; Shopping led at $789.09.');
      expect(error).toBeNull();
      expect(result!.reviewText).toContain('Visa Avion');
    });

    it('naming a category absent from the payload\'s cards is rejected: retried, then nothing saved and the name recorded', async () => {
      // Restaurants has a plan on Visa, but it is not a top overspend, so the
      // payload's cards do not carry it.
      const { error } = await generate('2026-09', 'Restaurants came in at $793.75.', 'Restaurants again, at $793.75.');
      expect((error as Error).name).toBe('LetterGuardError');
      const failed = recordedEvents.map((row) => ({ payload: row })).find((w) => (w.payload as { event_type: string }).event_type === 'review_guard_failed');
      expect((failed!.payload as { household_id: string; metadata: { names: string[]; month: string } })).toMatchObject({
        household_id: HH, metadata: { names: ['Restaurants'], month: '2026-09' },
      });
    });
  });
});

describe('monthReachedByRules', () => {
  const rule = { amount: 125, cadence: 'biweekly' as const, anchorDate: '2026-09-12', secondDay: null };

  it('counts each real occurrence after today, and names the month the target is reached', () => {
    // Occurrences after Oct 1: Oct 10, Oct 24 — 250 reached in October.
    expect(monthReachedByRules(250, 0, [rule], '2026-10-01')).toBe('2026-10');
    // Nov 7 is the third.
    expect(monthReachedByRules(375, 0, [rule], '2026-10-01')).toBe('2026-11');
  });

  it('a target already met is reached this month', () => {
    expect(monthReachedByRules(100, 100, [rule], '2026-10-01')).toBe('2026-10');
  });

  it('no rule, a rule with no date, or a zero amount: null, never a guess', () => {
    expect(monthReachedByRules(250, 0, [], '2026-10-01')).toBeNull();
    expect(monthReachedByRules(250, 0, [{ ...rule, anchorDate: null }], '2026-10-01')).toBeNull();
    expect(monthReachedByRules(250, 0, [{ ...rule, amount: 0 }], '2026-10-01')).toBeNull();
  });

  it('a rule split by an edit counts only from its effective date', () => {
    expect(monthReachedByRules(250, 0, [{ ...rule, effectiveFrom: '2026-11-01' }], '2026-10-01')).toBe('2026-11');
  });

  it('not reached within the horizon: null', () => {
    expect(monthReachedByRules(1_000_000, 0, [rule], '2026-10-01', 12)).toBeNull();
  });
});

describe('cardLetterFacts', () => {
  it('names categories as the Cards page does in French: name_fr, else the seed translation', () => {
    const facts = cardLetterFacts({
      cardId: 'v', cardName: 'Visa Avion', cycleMonth: '2026-09', cycleStart: '2026-08-28', cycleEnd: '2026-09-27',
      open: false, goal: 100, spent: 300, previousCycleSpent: 0,
      categories: [
        { categoryId: 'g', name: 'Groceries & Pharmacy', nameFr: null, plan: 100, actual: 300, previousActual: 0 },
        { categoryId: 'h', name: 'Hobbies', nameFr: 'Loisirs', plan: 10, actual: 20, previousActual: 0 },
      ],
    }, 'fr');
    expect(facts.topOverspends.map((o) => o.category)).toEqual(['Épicerie et pharmacie', 'Loisirs']);
  });
});
