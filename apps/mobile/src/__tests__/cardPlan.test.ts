import { describe, it, expect } from 'vitest';
import { ApiError } from '../lib/apiErrors';
import {
  buildPlanBody,
  canEditPlan,
  cardDetailPath,
  draftFrom,
  loadCardDetail,
  overGoal,
  parseCardDetail,
  savePlan,
  type PlanDraft,
} from '../lib/cardPlan';

// GET /api/card-envelope, shaped as the route answers it.
const ANSWER = {
  card: { id: 'card-1', name: 'MASTER', type: 'credit_card', statement_close_day: 15, payment_day: 5 },
  totalGoal: '2800.00',
  envelopeItems: [
    { categoryId: 'cat-gro', categoryName: 'Groceries', monthlyAmount: 550, actual: 480.5, remaining: 69.5, status: 'watch', planned: true },
    { categoryId: 'cat-res', categoryName: 'Restaurants', monthlyAmount: 0, actual: 42, remaining: -42, status: 'unset', planned: false },
  ],
  uncategorized: 12.25,
  totalSpent: 534.75,
  categories: [{ id: 'cat-gro', name: 'Groceries' }, { id: 'cat-res', name: 'Restaurants' }],
  entriesByCategory: {},
  uncategorizedEntries: [],
  cycleState: 'open',
  laterPlanMonths: ['2026-12'],
  pastPlan: null,
};

describe('reading a card', () => {
  it('asks the route for the card, the month and the language', () => {
    expect(cardDetailPath('card 1', '2026-11', 'fr')).toBe('/api/card-envelope?cardId=card%201&month=2026-11&locale=fr');
  });

  it('reads the answer, numerics sent as text included', () => {
    const d = parseCardDetail(ANSWER, '2026-11');
    expect(d.card).toEqual({ id: 'card-1', name: 'MASTER', statementCloseDay: 15, paymentDay: 5 });
    expect(d.totalGoal).toBe(2800);
    expect(d.budgets[0]).toEqual({
      categoryId: 'cat-gro', categoryName: 'Groceries', monthlyAmount: 550, actual: 480.5, remaining: 69.5, status: 'watch', planned: true,
    });
    expect(d.budgets[1].planned).toBe(false);
    expect(d.uncategorized).toBe(12.25);
    expect(d.laterPlanMonths).toEqual(['2026-12']);
  });

  it('no goal stays null — never $0', () => {
    expect(parseCardDetail({ ...ANSWER, totalGoal: null }, '2026-11').totalGoal).toBeNull();
  });

  it('an unreadable figure is an error, not a zero', () => {
    const bad = { ...ANSWER, envelopeItems: [{ ...ANSWER.envelopeItems[0], actual: 'abc' }] };
    expect(() => parseCardDetail(bad, '2026-11')).toThrow(/not a number/);
    expect(() => parseCardDetail({ ...ANSWER, card: null }, '2026-11')).toThrow(/no card/);
    expect(() => parseCardDetail({ ...ANSWER, cycleState: 'weird' }, '2026-11')).toThrow(/cycle state/);
  });

  it('loads through the getter it is given', async () => {
    const asked: string[] = [];
    const get = async <T,>(path: string) => { asked.push(path); return ANSWER as T; };
    const d = await loadCardDetail(get, 'card-1', '2026-11', 'en');
    expect(asked).toEqual(['/api/card-envelope?cardId=card-1&month=2026-11&locale=en']);
    expect(d.card.name).toBe('MASTER');
  });

  it('a closed statement offers no editor; an open or future one does', () => {
    expect(canEditPlan({ cycleState: 'closed' })).toBe(false);
    expect(canEditPlan({ cycleState: 'open' })).toBe(true);
    expect(canEditPlan({ cycleState: 'future' })).toBe(true);
  });
});

describe('the plan editor', () => {
  const detail = parseCardDetail(ANSWER, '2026-11');

  it('opens with the plan on screen only — spend-only categories are not budgets', () => {
    expect(draftFrom(detail)).toEqual({
      goal: '2800',
      items: [{ categoryId: 'cat-gro', categoryName: 'Groceries', amount: '550' }],
      closeDay: '15',
      payDay: '5',
    });
  });

  it('a card with nothing set opens blank', () => {
    const blank = parseCardDetail({ ...ANSWER, totalGoal: null, envelopeItems: [], card: { ...ANSWER.card, statement_close_day: null, payment_day: null } }, '2026-11');
    expect(draftFrom(blank)).toEqual({ goal: '', items: [], closeDay: '', payDay: '' });
  });

  const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({ ...draftFrom(detail), ...over });

  it('builds the body the route takes; a decimal comma is read exactly', () => {
    const built = buildPlanBody('card-1', '2026-11', draft({ goal: '2800,50', items: [{ categoryId: 'cat-gro', categoryName: 'G', amount: '12,50' }] }), null);
    expect(built).toEqual({
      ok: true,
      body: {
        cardId: 'card-1', month: '2026-11', totalGoal: 2800.5,
        items: [{ categoryId: 'cat-gro', monthlyAmount: 12.5 }],
        statementCloseDay: 15, paymentDay: 5,
      },
    });
  });

  it('blank days are sent as not set', () => {
    const built = buildPlanBody('card-1', '2026-11', draft({ closeDay: '', payDay: ' ' }), null);
    expect(built.ok && built.body.statementCloseDay).toBeNull();
    expect(built.ok && built.body.paymentDay).toBeNull();
  });

  it('the later-months answer goes with the save, for exactly the months shown', () => {
    const built = buildPlanBody('card-1', '2026-11', draft(), { choice: 'keep', months: ['2026-12'] });
    expect(built.ok && built.body).toMatchObject({ laterPlans: 'keep', laterPlanMonths: ['2026-12'] });
    const none = buildPlanBody('card-1', '2026-11', draft(), { choice: 'apply', months: [] });
    expect(none.ok && 'laterPlans' in none.body).toBe(false);
  });

  it.each([
    ['an unreadable goal', { goal: '12.5.0' }, 'goalInvalid'],
    ['a blank goal', { goal: '' }, 'goalInvalid'],
    ['a negative goal', { goal: '-5' }, 'goalInvalid'],
    ['a goal past the ceiling', { goal: '1000000000' }, 'goalInvalid'],
    ['a budget with three decimals', { items: [{ categoryId: 'cat-gro', categoryName: 'G', amount: '1.005' }] }, 'amountInvalid'],
    ['a negative budget', { items: [{ categoryId: 'cat-gro', categoryName: 'G', amount: '-1' }] }, 'amountInvalid'],
    ['a close day of 0', { closeDay: '0' }, 'closeDayInvalid'],
    ['a close day of 32', { closeDay: '32' }, 'closeDayInvalid'],
    ['a close day with a decimal', { closeDay: '15.5' }, 'closeDayInvalid'],
    ['a payment day of 32', { payDay: '32' }, 'payDayInvalid'],
  ])('%s is refused before anything is sent (%s)', (_label, over, problem) => {
    const built = buildPlanBody('card-1', '2026-11', draft(over as Partial<PlanDraft>), null);
    expect(built).toMatchObject({ ok: false, problem });
  });

  it('days 1 and 31 and a $0 budget are fine', () => {
    const built = buildPlanBody('card-1', '2026-11', draft({ closeDay: '1', payDay: '31', items: [{ categoryId: 'cat-gro', categoryName: 'G', amount: '0' }] }), null);
    expect(built.ok).toBe(true);
  });

  it('budgets over the goal warn; equal does not', () => {
    expect(overGoal(draft({ goal: '500', items: [{ categoryId: 'a', categoryName: 'A', amount: '300' }, { categoryId: 'b', categoryName: 'B', amount: '200.01' }] }))).toBe(true);
    expect(overGoal(draft({ goal: '500', items: [{ categoryId: 'a', categoryName: 'A', amount: '300' }, { categoryId: 'b', categoryName: 'B', amount: '200' }] }))).toBe(false);
  });
});

describe('saving the plan', () => {
  const body = {
    cardId: 'card-1', month: '2026-11', totalGoal: 2800,
    items: [{ categoryId: 'cat-gro', monthlyAmount: 550 }], statementCloseDay: 15, paymentDay: 5,
  };
  const answering = (result: unknown) => async <T,>(_path: string, _body: unknown) => {
    if (result instanceof Error) throw result;
    return result as T;
  };

  it('posts to the card-envelope route', async () => {
    const sent: { path: string; body: unknown }[] = [];
    const post = async <T,>(path: string, b: unknown) => { sent.push({ path, body: b }); return { saved: true } as T; };
    expect(await savePlan(post, body)).toEqual({ kind: 'saved' });
    expect(sent).toEqual([{ path: '/api/card-envelope', body }]);
  });

  it('saved, but the days did not: said, not hidden behind "saved"', async () => {
    expect(await savePlan(answering({ saved: true, daysUpdateFailed: true }), body)).toEqual({ kind: 'savedDaysFailed' });
  });

  it('later months with their own plans: reload and ask', async () => {
    const err = new ApiError('server', 409, 'later_plans_decision_required');
    expect(await savePlan(answering(err), body)).toEqual({ kind: 'laterPlansRequired' });
  });

  it.each([
    ['cycle_closed', 'cardPlan.errors.cycleClosed'],
    ['later_plans_remove_failed', 'cardPlan.errors.laterPlansRemoveFailed'],
    ['unknown_category', 'cardPlan.errors.unknownCategory'],
  ])('%s has its own message', async (code, messageKey) => {
    const err = new ApiError('server', code === 'unknown_category' ? 400 : 409, code);
    expect(await savePlan(answering(err), body)).toEqual({ kind: 'error', messageKey });
  });

  it('anything else falls back to the status-based message', async () => {
    const out = await savePlan(answering(new ApiError('network', null, null)), body);
    expect(out.kind).toBe('error');
    expect(out.kind === 'error' && out.messageKey).not.toMatch(/^cardPlan/);
  });
});

describe('a category expanded: its entries', () => {
  const withEntries = {
    ...ANSWER,
    entriesByCategory: {
      'cat-gro': [
        { id: 'e2', date: '2026-10-20', description: 'IGA', amount: '80.25', type: 'expense', installmentLabel: null },
        { id: 'e1', date: '2026-10-17', description: 'Costco', amount: 400.25, type: 'expense', installmentLabel: null },
        { id: 'e3', date: '2026-10-21', description: 'Refund', amount: 12, type: 'income', installmentLabel: null },
      ],
    },
    uncategorizedEntries: [{ id: 'u1', date: '2026-10-18', description: null, amount: 12.25, type: 'expense', installmentLabel: '2/6' }],
  };

  it('each category keeps its own entries, oldest first, numerics read exactly', () => {
    const d = parseCardDetail(withEntries, '2026-11');
    expect(d.entriesByCategory['cat-gro'].map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(d.entriesByCategory['cat-gro'][1]).toEqual({ id: 'e2', date: '2026-10-20', description: 'IGA', amount: 80.25, type: 'expense', installmentLabel: null });
  });

  it('a refund stays a refund (income), not spend', () => {
    expect(parseCardDetail(withEntries, '2026-11').entriesByCategory['cat-gro'][2].type).toBe('income');
  });

  it('entries with no category, with no description and an installment label, are kept', () => {
    expect(parseCardDetail(withEntries, '2026-11').uncategorizedEntries).toEqual([
      { id: 'u1', date: '2026-10-18', description: null, amount: 12.25, type: 'expense', installmentLabel: '2/6' },
    ]);
  });

  it('an unreadable entry amount is an error, not a zero', () => {
    const bad = { ...withEntries, uncategorizedEntries: [{ ...withEntries.uncategorizedEntries[0], amount: 'abc' }] };
    expect(() => parseCardDetail(bad, '2026-11')).toThrow(/not a number/);
  });

  it('an answer with no entries reads as none, not an error', () => {
    const d = parseCardDetail(ANSWER, '2026-11');
    expect(d.entriesByCategory).toEqual({});
    expect(d.uncategorizedEntries).toEqual([]);
  });
});
