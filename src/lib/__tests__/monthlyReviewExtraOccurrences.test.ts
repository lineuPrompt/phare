import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Guard events are written through the service role (eventWriter, launch plan
// 1.1), not the fake session: read them from the suite-wide recorder.
import { recordedEvents } from '../../test/eventWriterDouble';
import { makeFakeCardSupabase, type Row } from '@/app/api/card-envelope/__tests__/fakeCardSupabase';
import { splitExtraOccurrences, oneTimeNetEffect, type WindfallFlag } from '@/lib/reviewContextHelpers';
import { findExpenseMisframing, checkTopRecommendationFigures } from '@/lib/letterGuards';

// ---------------------------------------------------------------------------
// EXTRA INCOME VS EXTRA EXPENSES (2026-10-13).
//
// Zezinho Test's October 2026 letter called a third biweekly car payment a
// "$350 windfall" and told the household to move it to the emergency fund,
// and forecast next month's expenses from September's total. The cause: the
// review passed extra expense occurrences to the model in a list named
// "windfalls", and both prompts described every entry as a windfall. The
// typical surplus also counted an extra expense against its month twice.
// ---------------------------------------------------------------------------

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => createMock(...a) } },
}));

const flag = (type: 'income' | 'expense', amount: number, label = 'x'): WindfallFlag =>
  ({ label, type, cadence: 'biweekly', occurrences: 3, typicalOccurrences: 2, amount });

describe('splitExtraOccurrences', () => {
  it('income goes to extraIncome, expenses to extraExpenses, with the code\'s counts', () => {
    expect(splitExtraOccurrences([flag('income', 2749, 'Pay'), flag('expense', 350, 'Car payment')])).toEqual({
      extraIncome: [{ name: 'Pay', cadence: 'biweekly', occurrences: 3, usualOccurrences: 2, extraAmount: 2749 }],
      extraExpenses: [{ name: 'Car payment', cadence: 'biweekly', occurrences: 3, usualOccurrences: 2, extraAmount: 350 }],
    });
  });
});

describe('oneTimeNetEffect', () => {
  it('extra income raised the month; an extra expense lowered it', () => {
    expect(oneTimeNetEffect([flag('income', 2749)])).toBe(2749);
    expect(oneTimeNetEffect([flag('expense', 350)])).toBe(-350);
    expect(oneTimeNetEffect([flag('income', 2749.1), flag('expense', 350.05)])).toBe(2399.05);
  });
});

describe('findExpenseMisframing', () => {
  const car = [{ name: 'Car payment 1 / Paiement auto 1', extraAmount: 350 }];

  it('Zezinho Test, October 2026: the extra car payment called a windfall and directed to a fund', () => {
    const text = 'The clearest move this month is to direct that one-time $350 car payment windfall toward opening your emergency fund.';
    const found = findExpenseMisframing(text, [], car);
    expect(found).toHaveLength(2);
    expect(found[0]).toBe('"windfall" with no extra income this month');
    expect(found[1]).toMatch(/^extra expense "Car payment 1 \/ Paiement auto 1" called a windfall: /);
  });

  it('naming the expense, or only its amount, beside a word that moves money', () => {
    expect(findExpenseMisframing('Put the extra $350 toward savings.', [], car)).toHaveLength(1);
    expect(findExpenseMisframing('Car payment 1 / Paiement auto 1 could move into savings.', [], car)).toHaveLength(1);
    expect(findExpenseMisframing('Vous pourriez verser ces 350 $ dans votre fonds.', [], car)).toHaveLength(1);
  });

  it('an honest acknowledgement passes: extra spending, no money moved', () => {
    const text = 'Car payment 1 / Paiement auto 1 landed three times instead of two, adding $350 of spending that will not repeat.';
    expect(findExpenseMisframing(text, [], car)).toEqual([]);
  });

  it('"windfall" is allowed for real extra income, never for the expense', () => {
    const pay = [{ name: 'Salary', extraAmount: 2749 }];
    expect(findExpenseMisframing('A third paycheque, a $2,749 windfall.', pay, car)).toEqual([]);
    expect(findExpenseMisframing('A third paycheque, a $2,749 windfall.', [], car)).toEqual(['"windfall" with no extra income this month']);
  });
});

describe('checkTopRecommendationFigures', () => {
  it('only the allowed sources, exactly or rounded to the dollar', () => {
    expect(checkTopRecommendationFigures('Put $192 toward the trip.', [1870, 192.31]).ok).toBe(true);
    expect(checkTopRecommendationFigures('Put $350 toward the fund.', [1870, 192.31]).offending).toEqual(['$350']);
  });
});

// ── End to end, on a household shaped like Zezinho Test ─────────────────────

const HH = 'hh-1';
const CHQ = 'chq';
const CAR = 'r-car';
let n = 0;
const tx = (date: string, amount: number, type: string, extra: Row = {}): Row =>
  ({ id: `t${++n}`, household_id: HH, account_id: CHQ, date, amount, type, transfer_peer_id: null, recurring_item_id: null, description: null, category_id: null, is_bridge: false, ...extra });
const car = (date: string) => tx(date, 350, 'expense', { description: 'Car payment', recurring_item_id: CAR });
const pay = (date: string) => tx(date, 5000, 'income', { description: 'Salary' });

function seed(): Record<string, Row[]> {
  n = 0;
  return {
    households: [{ id: HH, timezone: 'America/Toronto' }],
    accounts: [{ id: CHQ, household_id: HH, name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, is_sinking_fund: false, statement_close_day: null, payment_day: null }],
    categories: [], sinking_funds: [], card_envelope_items: [], monthly_goals: [], account_balance_anchors: [], events: [],
    recurring_items: [{ id: CAR, household_id: HH, type: 'expense', active: true, amount: 350, cadence: 'biweekly', description: 'Car payment', anchor_date: '2026-07-01' }],
    transactions: [
      // July: three car payments (Jul 1, 15, 29) — an extra expense.
      pay('2026-07-02'), car('2026-07-01'), car('2026-07-15'), car('2026-07-29'),
      // August: two.
      pay('2026-08-02'), car('2026-08-12'), car('2026-08-26'),
      // September (reviewed): three again.
      pay('2026-09-02'), car('2026-09-09'), car('2026-09-23'), car('2026-09-30'),
    ],
  };
}

async function generate(planTexts: string[], reviewTexts: string[]) {
  createMock.mockReset();
  for (const p of planTexts) createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: p }) }] });
  for (const r of reviewTexts) createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: r }] });
  const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
  const fake = makeFakeCardSupabase(seed());
  let error: Error | null = null;
  try {
    await generateMonthlyReview({ supabase: fake.client as never, householdId: HH, locale: 'en', timezone: 'America/Toronto', reviewMonth: '2026-09', userId: null });
  } catch (e) { error = e as Error; }
  const reviewCall = createMock.mock.calls.find((c) => String(c[0].messages[0].content).includes('Their plan:\n'));
  const prompt = reviewCall ? (reviewCall[0].messages[0].content as string) : '';
  const payload = prompt ? JSON.parse(prompt.slice(prompt.indexOf('Their plan:\n') + 12, prompt.indexOf('\n\nWrite '))) : null;
  return { payload, prompt, planPrompt: createMock.mock.calls[0][0].messages[0].content as string, fake, error };
}

describe('the review, end to end', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00-04:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('the extra car payment is an extra EXPENSE in the payload; there is no "windfalls" list', async () => {
    const { payload, planPrompt } = await generate(['Keep going.'], ['September was steady.']);
    expect(payload.extraExpenses).toEqual([{ name: 'Car payment', cadence: 'biweekly', occurrences: 3, usualOccurrences: 2, extraAmount: 350 }]);
    expect(payload.extraIncome).toEqual([]);
    expect(payload).not.toHaveProperty('windfalls');
    expect(planPrompt).toContain('NOT money available and must never be directed anywhere');
  });

  it('typical surplus adds an extra expense back: July counts as 4,300, not 3,600', async () => {
    const { payload } = await generate(['Keep going.'], ['September was steady.']);
    // July 5000 − 1050 = 3950, normalised + 350 = 4300; August 5000 − 700 = 4300.
    expect(payload.coaching.typicalSurplus).toBe(4300);
  });

  it('the letter prompt carries the three new rules', async () => {
    const { prompt } = await generate(['Keep going.'], ['September was steady.']);
    expect(prompt).toContain('An extra expense is extra SPENDING');
    expect(prompt).toContain('- NO FORECASTS: never predict a future figure');
    expect(prompt).toContain('- THE RECOMMENDATION may direct money only from');
  });

  it('a letter that moves the extra expense is retried, then refused, and nothing is saved', async () => {
    const bad = 'Put that one-time $350 car payment windfall toward your emergency fund.';
    const { error } = await generate(['Keep going.'], [bad, bad]);
    expect(error?.name).toBe('LetterGuardError');
    const failed = recordedEvents.map((row) => ({ payload: row })).find((w) => (w.payload as { event_type: string }).event_type === 'review_guard_failed');
    expect((failed!.payload as { metadata: { kind: string; framing: string[] } }).metadata).toMatchObject({ kind: 'monthly_review' });
    expect((failed!.payload as { metadata: { framing: string[] } }).metadata.framing.length).toBeGreaterThan(0);
  });

  it('a top recommendation that moves the extra expense is retried; the clean retry is used', async () => {
    const { payload, error } = await generate(
      // No figure at all: only the framing check can refuse it.
      ['Move the Car payment windfall into savings.', 'Keep going.'],
      ['September was steady.']
    );
    expect(error).toBeNull();
    expect(payload.topRecommendation).toBe('Keep going.');
  });

  it('a top recommendation with a figure from no money source fails visibly on the second try', async () => {
    const { error } = await generate(
      ['Put $500 toward savings.', 'Put $600 toward savings.'],
      []
    );
    expect(error?.name).toBe('LetterGuardError');
    expect(error?.message).toContain('$600');
    const failed = recordedEvents.map((row) => ({ payload: row })).find((w) => (w.payload as { event_type: string }).event_type === 'review_guard_failed');
    expect((failed!.payload as { metadata: { kind: string; figures: string[] } }).metadata).toMatchObject({ kind: 'top_recommendation', figures: ['$600'] });
  });

  it('a top recommendation using the month\'s own surplus passes', async () => {
    // September: 5000 − 1050 = 3950.
    const { payload, error } = await generate(['Put $3,950 of this month\'s surplus toward savings.'], ['September was steady.']);
    expect(error).toBeNull();
    expect(payload.topRecommendation).toBe('Put $3,950 of this month\'s surplus toward savings.');
  });
});
