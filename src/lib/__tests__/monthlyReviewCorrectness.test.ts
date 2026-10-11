import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, type Row } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';
import { contributionRuleFact, monthlyShortfall } from '@/lib/coachingHelpers';

// ---------------------------------------------------------------------------
// MONTHLY REVIEW — CORRECTNESS (Part A, 2026-10-10).
//
// Each test reproduces one way September 2026's letter for a real household
// was wrong, on a small household whose query results the fake actually
// filters (eq / in / gte / lt really narrow the rows):
//
//   b) a goal's REQUIRED amount was called its "monthly contribution";
//   c) the "one move" put more toward a reserve the plan already funds;
//   d) a month holding only card rows counted as a real month of surplus;
//   e) the payload said savings were 0.
//
// (a), the reviewed month's card cycles, is pinned in cardOverTarget.test.ts
// and reviewOverTargetWiring.test.ts.
// ---------------------------------------------------------------------------

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => createMock(...a) } },
}));

const HH = 'hh-1';
const CHQ = 'chq';
const TRAVEL = 'goal-travel';
const BUFFER = 'buffer';

const tx = (id: string, account_id: string, date: string, amount: number, type: string, extra: Row = {}): Row =>
  ({ id, household_id: HH, account_id, date, amount, type, transfer_peer_id: null, recurring_item_id: null, description: null, category_id: null, is_bridge: false, ...extra });

/** A chequing → account transfer: both legs, peered. */
function transfer(id: string, to: string, date: string, amount: number, extraTo: Row = {}): Row[] {
  return [
    tx(`${id}-out`, CHQ, date, amount, 'transfer', { transfer_peer_id: `${id}-in` }),
    tx(`${id}-in`, to, date, amount, 'transfer', { transfer_peer_id: `${id}-out`, ...extraTo }),
  ];
}

function seed(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    households: [{ id: HH, timezone: 'America/Toronto' }],
    accounts: [
      { id: CHQ, household_id: HH, name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, is_sinking_fund: false, statement_close_day: null },
      { id: TRAVEL, household_id: HH, name: 'Travel', type: 'savings', goal_target: 13000, goal_target_date: '2028-12-28', is_sinking_fund: false, statement_close_day: null },
      { id: BUFFER, household_id: HH, name: 'Sinking funds', type: 'savings', goal_target: null, goal_target_date: null, is_sinking_fund: true, statement_close_day: null },
    ],
    sinking_funds: [
      { household_id: HH, name: 'Property tax', annual_amount: 3106.2, monthly_provision: 258.85, due_month: 3, due_day: null, linked_account_id: BUFFER, active: true },
      { household_id: HH, name: 'Income tax', annual_amount: 2000, monthly_provision: 166.67, due_month: 4, due_day: null, linked_account_id: BUFFER, active: true },
    ],
    recurring_items: [
      // Travel: $125 every two weeks — $270.83/month by monthlyEquivalent.
      { id: 'r-travel', household_id: HH, type: 'transfer', active: true, amount: 125, cadence: 'biweekly', destination_account_id: TRAVEL, accounts: { name: 'Travel', type: 'savings' } },
      // The reserve: $425.52 a month, exactly the two provisions together.
      { id: 'r-buffer', household_id: HH, type: 'transfer', active: true, amount: 425.52, cadence: 'monthly', destination_account_id: BUFFER, accounts: { name: 'Sinking funds', type: 'savings' } },
    ],
    transactions: [
      // Opening balance on the goal, dated inside September: not a deposit.
      tx('open-1', TRAVEL, '2026-09-01', 160, 'transfer', { is_opening_balance: true }),
      // June: card rows only — never a real month.
      tx('jun-card', 'card-x', '2026-06-10', 500, 'expense'),
      // July and August: real chequing months.
      tx('jul-in', CHQ, '2026-07-02', 5000, 'income'),
      tx('jul-out', CHQ, '2026-07-03', 3000, 'expense'),
      tx('aug-in', CHQ, '2026-08-02', 5000, 'income'),
      tx('aug-out', CHQ, '2026-08-03', 4000, 'expense'),
      // September: income, a bill, and two transfers to savings.
      tx('sep-in', CHQ, '2026-09-02', 6000, 'income'),
      tx('sep-out', CHQ, '2026-09-03', 4500, 'expense'),
      ...transfer('t1', TRAVEL, '2026-09-12', 125),
      ...transfer('t2', TRAVEL, '2026-10-10', 125), // future-dated: not deposited yet
      ...transfer('t3', TRAVEL, '2026-10-01', 40), // today, but October's: not September's deposit
      ...transfer('b1', BUFFER, '2026-08-30', 425.52),
    ],
    card_envelope_items: [],
    monthly_goals: [],
    events: [],
    ...over,
  };
}

function aiReturns(text: string) {
  return { content: [{ type: 'text', text }] };
}

async function run(store = seed()) {
  const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
  const { client } = makeFakeCardSupabase(store);
  await generateMonthlyReview({
    supabase: client as never,
    householdId: HH,
    locale: 'en',
    timezone: 'America/Toronto',
    reviewMonth: '2026-09',
    userId: null,
  });
  const prompt = createMock.mock.calls[1][0].messages[0].content as string;
  const json = prompt.slice(prompt.indexOf('Their plan:\n') + 'Their plan:\n'.length, prompt.indexOf('\n\nWrite '));
  return { payload: JSON.parse(json), prompt, planPrompt: createMock.mock.calls[0][0].messages[0].content as string };
}

describe('monthly review — Part A correctness', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00-04:00'));
    createMock.mockReset();
    createMock
      .mockResolvedValueOnce(aiReturns(JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' })))
      .mockResolvedValueOnce(aiReturns('September was steady.'));
  });
  afterEach(() => { vi.useRealTimers(); });

  describe('b) a goal\'s required amount is never its contribution', () => {
    it('carries the required amount, the actual rule and what landed this month, apart', async () => {
      const { payload } = await run();
      const [goal] = payload.goals;
      expect(goal.name).toBe('Travel');
      expect(goal.requiredMonthly).toBeGreaterThan(0);
      expect(goal.contributionRules).toEqual([{ amount: 125, cadence: 'biweekly' }]);
      // One $125 landed in September. The Oct 10 row is future-dated and the
      // opening balance is a starting position, not a deposit.
      expect(goal.depositedThisMonth).toBe(125);
    });

    it('the goal objects carry no "monthlyContribution" and no "onTrack", in either prompt', async () => {
      const { payload, planPrompt } = await run();
      expect(Object.keys(payload.goals[0])).not.toContain('monthlyContribution');
      expect(Object.keys(payload.goals[0])).not.toContain('onTrack');
      expect(planPrompt).toContain('"requiredMonthly"');
      expect(planPrompt).not.toContain('"monthlyContribution"');
    });

    it('a goal with no recurring transfer has an empty rule list, not a guessed one', async () => {
      const { payload } = await run(seed({ recurring_items: seed().recurring_items!.filter((r) => r.id !== 'r-travel') }));
      expect(payload.goals[0].contributionRules).toEqual([]);
    });

    it('the prompt forbids calling the required amount a contribution', async () => {
      const { prompt } = await run();
      expect(prompt).toContain('NEVER call it a contribution');
    });
  });

  describe('c) needs the plan already funds in full are not coached toward', () => {
    it('a reserve whose rule covers every provision is not a ranked need', async () => {
      const { payload } = await run();
      const names = payload.coaching.rankedNeeds.map((n: { name: string }) => n.name);
      expect(names).not.toContain('Property tax');
      expect(names).not.toContain('Income tax');
    });

    it('a reserve whose rule falls short keeps its provisions as needs', async () => {
      const store = seed({
        recurring_items: seed().recurring_items!.map((r) => (r.id === 'r-buffer' ? { ...r, amount: 300 } : r)),
      });
      const { payload } = await run(store);
      const names = payload.coaching.rankedNeeds.map((n: { name: string }) => n.name);
      expect(names).toEqual(expect.arrayContaining(['Property tax', 'Income tax']));
    });

    it('a partly covered goal ranks on what it still lacks, and the extra is capped by that', async () => {
      const { payload } = await run();
      const travel = payload.coaching.rankedNeeds.find((n: { name: string }) => n.name === 'Travel');
      const required = payload.goals[0].requiredMonthly;
      // $125 biweekly = $270.83 a month (monthlyEquivalent).
      expect(travel.monthlyShortfall).toBe(Math.round((required - 270.83) * 100) / 100);
      expect(payload.coaching.startingContribution).toBeLessThanOrEqual(travel.monthlyShortfall);
    });

    it('a goal its own rules cover in full is not a ranked need', async () => {
      const store = seed({
        recurring_items: seed().recurring_items!.map((r) => (r.id === 'r-travel' ? { ...r, amount: 5000, cadence: 'monthly' } : r)),
      });
      const { payload } = await run(store);
      expect(payload.coaching.rankedNeeds.map((n: { name: string }) => n.name)).not.toContain('Travel');
    });
  });

  describe('d) a month with only card rows is not a real month', () => {
    it('June (card rows only) is left out of the typical surplus, and history reads as thin', async () => {
      const { payload } = await run();
      // July +2000; August 5000 − 4000 − the 425.52 reserve transfer = +574.48.
      // Average of the two real months: 1287.24. Counting June as a real
      // month of 0 would give 858.16.
      expect(payload.coaching.monthsOfHistoryUsed).toBe(2);
      expect(payload.coaching.typicalSurplus).toBe(1287.24);
      expect(payload.coaching.insufficientHistory).toBe(true);
    });
  });

  describe('e) the payload carries the month\'s real savings', () => {
    it('savings is computeMonthTotals\' figure, not 0', async () => {
      const { payload } = await run();
      // Only the Sep 12 transfer is in September (the Oct 10 one is October's).
      expect(payload.month.savings).toBe(125);
    });
  });
});

describe('contribution rule helpers', () => {
  it('monthlyShortfall counts every rule through monthlyEquivalent, never below 0', () => {
    expect(monthlyShortfall(489.04, [{ amount: 125, cadence: 'biweekly' }])).toBe(218.21);
    expect(monthlyShortfall(425.52, [{ amount: 425.52, cadence: 'monthly' }])).toBe(0);
    expect(monthlyShortfall(100, [{ amount: 30, cadence: 'weekly' }, { amount: 10, cadence: 'monthly' }])).toBe(0);
    expect(monthlyShortfall(300, [])).toBe(300);
  });

  it('an unknown cadence throws rather than guessing a frequency', () => {
    expect(() => contributionRuleFact(100, 'yearly')).toThrow('unknown contribution cadence "yearly"');
    expect(contributionRuleFact('125.00', 'biweekly')).toEqual({ amount: 125, cadence: 'biweekly' });
  });
});
