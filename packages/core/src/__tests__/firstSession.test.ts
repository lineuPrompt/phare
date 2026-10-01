import { describe, it, expect } from 'vitest';
import {
  BILL_CHECKLIST,
  FIRST_SESSION_LABEL_MAX_CHARS,
  FIRST_SESSION_MAX_BILLS,
  FIRST_SESSION_MAX_INCOMES,
  SEED_EXPENSE_CATEGORIES,
  buildFirstSessionRules,
  emptyDraftLine,
  firstSessionRequestFromDraft,
  monthlyAnchorDate,
  validateFirstSessionRequest,
  type FirstSessionDraft,
} from '../firstSession';

const TODAY = '2026-10-01';

const pay = { label: 'Pay', amount: 2100, frequency: 'biweekly', nextDate: '2026-10-09' };
const rent = { item: 'rent', label: 'Rent', amount: 1800, frequency: 'monthly', dayOfMonth: 1 };
const valid = { incomes: [pay], openingBalance: 1250.5, bills: [rent] };

function problemsOf(body: unknown) {
  const r = validateFirstSessionRequest(body, TODAY);
  return r.ok ? [] : r.problems;
}

describe('validateFirstSessionRequest — accepts', () => {
  it('a request with one pay, a balance and one checklist bill', () => {
    expect(validateFirstSessionRequest(valid, TODAY)).toEqual({ ok: true, value: valid });
  });

  it('every frequency with its own date field, an "other" bill with a seed category, a negative or zero balance', () => {
    const body = {
      incomes: [
        { label: 'A', amount: 900, frequency: 'weekly', nextDate: '2026-10-08' },
        { label: 'B', amount: 2500, frequency: 'semimonthly', days: [15, 31] },
        { label: 'C', amount: 4000, frequency: 'monthly', dayOfMonth: 25 },
      ],
      openingBalance: -340.12,
      bills: [{ item: 'other', label: 'Gym', amount: 45.99, category: 'Health & Personal', frequency: 'monthly', dayOfMonth: 3 }],
    };
    expect(validateFirstSessionRequest(body, TODAY).ok).toBe(true);
    expect(validateFirstSessionRequest({ ...valid, openingBalance: 0 }, TODAY).ok).toBe(true);
  });

  it('no bills at all', () => {
    expect(validateFirstSessionRequest({ ...valid, bills: [] }, TODAY).ok).toBe(true);
  });
});

describe('validateFirstSessionRequest — refuses, naming where', () => {
  it.each([
    ['no income', { ...valid, incomes: [] }, { section: 'incomes', code: 'no_income' }],
    ['a checklist bill carrying its own category (code decides it)', { ...valid, bills: [{ ...rent, category: 'Shopping' }] }, { section: 'bills', index: 0, code: 'category_not_allowed' }],
    ['an "other" bill with no category', { ...valid, bills: [{ ...rent, item: 'other' }] }, { section: 'bills', index: 0, code: 'category_invalid' }],
    ['an "other" bill with a category off the seed list', { ...valid, bills: [{ ...rent, item: 'other', category: 'Boats' }] }, { section: 'bills', index: 0, code: 'category_invalid' }],
    ['an unknown checklist item', { ...valid, bills: [{ ...rent, item: 'yacht' }] }, { section: 'bills', index: 0, code: 'item_invalid' }],
    ['a blank label', { ...valid, incomes: [{ ...pay, label: '  ' }] }, { section: 'incomes', index: 0, code: 'label_missing' }],
    ['a label over the limit (refused, not trimmed)', { ...valid, incomes: [{ ...pay, label: 'x'.repeat(FIRST_SESSION_LABEL_MAX_CHARS + 1) }] }, { section: 'incomes', index: 0, code: 'label_too_long' }],
    ['a zero amount', { ...valid, incomes: [{ ...pay, amount: 0 }] }, { section: 'incomes', index: 0, code: 'amount_invalid' }],
    ['a negative amount', { ...valid, bills: [{ ...rent, amount: -5 }] }, { section: 'bills', index: 0, code: 'amount_invalid' }],
    ['fractions of a cent', { ...valid, incomes: [{ ...pay, amount: 10.005 }] }, { section: 'incomes', index: 0, code: 'amount_invalid' }],
    ['an amount past the ceiling', { ...valid, incomes: [{ ...pay, amount: 1_000_000_000 }] }, { section: 'incomes', index: 0, code: 'amount_invalid' }],
    ['an unknown frequency', { ...valid, incomes: [{ ...pay, frequency: 'fortnightly' }] }, { section: 'incomes', index: 0, code: 'frequency_invalid' }],
    ['a bi-weekly next date in the past', { ...valid, incomes: [{ ...pay, nextDate: '2026-09-30' }] }, { section: 'incomes', index: 0, code: 'next_date_past' }],
    ['a bi-weekly next date more than two weeks out', { ...valid, incomes: [{ ...pay, nextDate: '2026-10-16' }] }, { section: 'incomes', index: 0, code: 'next_date_too_far' }],
    ['a weekly next date more than a week out', { ...valid, incomes: [{ ...pay, frequency: 'weekly', nextDate: '2026-10-09' }] }, { section: 'incomes', index: 0, code: 'next_date_too_far' }],
    ['a date that does not exist', { ...valid, incomes: [{ ...pay, nextDate: '2026-02-30' }] }, { section: 'incomes', index: 0, code: 'next_date_invalid' }],
    ['semi-monthly days that are the same', { ...valid, incomes: [{ label: 'P', amount: 1, frequency: 'semimonthly', days: [15, 15] }] }, { section: 'incomes', index: 0, code: 'days_same' }],
    ['semi-monthly day 32', { ...valid, incomes: [{ label: 'P', amount: 1, frequency: 'semimonthly', days: [1, 32] }] }, { section: 'incomes', index: 0, code: 'days_invalid' }],
    ['a monthly line with no day (nothing defaults to the 1st)', { ...valid, bills: [{ item: 'rent', label: 'Rent', amount: 1800, frequency: 'monthly' }] }, { section: 'bills', index: 0, code: 'day_of_month_invalid' }],
    ['monthly day 0', { ...valid, bills: [{ ...rent, dayOfMonth: 0 }] }, { section: 'bills', index: 0, code: 'day_of_month_invalid' }],
    ['a date field left over from another frequency', { ...valid, bills: [{ ...rent, nextDate: '2026-10-05' }] }, { section: 'bills', index: 0, code: 'unexpected_field' }],
    ['an unknown field on a line (e.g. an account id)', { ...valid, bills: [{ ...rent, accountId: 'x' }] }, { section: 'bills', index: 0, code: 'unexpected_field' }],
    ['an unparseable balance', { ...valid, openingBalance: Number.NaN }, { section: 'openingBalance', code: 'opening_invalid' }],
  ])('%s', (_label, body, problem) => {
    expect(problemsOf(body)).toContainEqual(problem);
  });

  it('an unknown top-level field (e.g. a household id) refuses the whole request', () => {
    expect(problemsOf({ ...valid, householdId: 'someone-else' })).toEqual([{ section: 'request', code: 'unexpected_field' }]);
  });

  it('too many lines is refused outright, never trimmed', () => {
    expect(problemsOf({ ...valid, incomes: Array(FIRST_SESSION_MAX_INCOMES + 1).fill(pay) }))
      .toContainEqual({ section: 'incomes', code: 'too_many' });
    expect(problemsOf({ ...valid, bills: Array(FIRST_SESSION_MAX_BILLS + 1).fill(rent) }))
      .toContainEqual({ section: 'bills', code: 'too_many' });
  });

  it('reports every bad line, not just the first', () => {
    const body = { ...valid, incomes: [{ ...pay, amount: 0 }, pay, { ...pay, label: '' }] };
    expect(problemsOf(body)).toEqual([
      { section: 'incomes', index: 0, code: 'amount_invalid' },
      { section: 'incomes', index: 2, code: 'label_missing' },
    ]);
  });
});

describe('the checklist', () => {
  it('assigns every item a seed category', () => {
    for (const item of BILL_CHECKLIST) expect(SEED_EXPENSE_CATEGORIES).toContain(item.category);
  });
});

describe('monthlyAnchorDate — a real day, in a month that has it', () => {
  it('uses today\'s month when the day exists in it', () => {
    expect(monthlyAnchorDate('2026-10-01', 15)).toBe('2026-10-15');
    expect(monthlyAnchorDate('2026-10-20', 31)).toBe('2026-10-31');
  });

  it('moves to the next month that has the day (the 31st from September)', () => {
    expect(monthlyAnchorDate('2026-09-10', 31)).toBe('2026-10-31');
    expect(monthlyAnchorDate('2027-02-01', 30)).toBe('2027-03-30');
  });
});

describe('buildFirstSessionRules', () => {
  const req = {
    incomes: [
      { label: ' Pay ', amount: 2100, frequency: 'biweekly' as const, nextDate: '2026-10-09' },
      { label: 'Pay 2', amount: 2500, frequency: 'semimonthly' as const, days: [30, 15] as [number, number] },
    ],
    openingBalance: 100,
    bills: [
      { item: 'hydro' as const, label: 'Hydro', amount: 120, frequency: 'monthly' as const, dayOfMonth: 31 },
      { item: 'other' as const, label: 'Gym', amount: 45, category: 'Health & Personal' as const, frequency: 'monthly' as const, dayOfMonth: 3 },
    ],
  };
  const rules = buildFirstSessionRules(req, TODAY);

  it('incomes have no category; checklist bills take the checklist\'s, "other" the household\'s', () => {
    expect(rules.map((r) => [r.description, r.type, r.category])).toEqual([
      ['Pay', 'income', null],
      ['Pay 2', 'income', null],
      ['Hydro', 'expense', 'Utilities & Subscriptions'],
      ['Gym', 'expense', 'Health & Personal'],
    ]);
  });

  it("a checklist bill's category is the checklist's even if a category rode along (code decides)", () => {
    const smuggled = { ...req, bills: [{ ...req.bills[0], category: 'Shopping' as const }] };
    expect(buildFirstSessionRules(smuggled, TODAY)[2].category).toBe('Utilities & Subscriptions');
  });

  it('anchors every line on the date it was given', () => {
    expect(rules.map((r) => [r.cadence, r.anchorDate, r.secondDay])).toEqual([
      ['biweekly', '2026-10-09', null],
      ['semimonthly', '2026-10-15', 30],
      ['monthly', '2026-10-31', null],
      ['monthly', '2026-10-03', null],
    ]);
  });

  it('dates twelve months of real occurrences from the start of today\'s month — the 31st clamps in short months, never the 1st', () => {
    const hydro = rules[2].dates;
    expect(hydro).toHaveLength(12);
    expect(hydro.slice(0, 3)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
    expect(hydro).toContain('2027-02-28');
    expect(hydro.every((d) => !d.endsWith('-01'))).toBe(true);
    const pay1 = rules[0].dates;
    expect(pay1[0]).toBe('2026-10-09');
    expect(pay1).toContain('2026-10-23');
  });
});

describe('firstSessionRequestFromDraft — from what was typed', () => {
  const draft = (): FirstSessionDraft => ({
    incomes: [{ ...emptyDraftLine(), amount: '2100,50', nextDate: '2026-10-09' }],
    openingBalance: '-1250,00',
    bills: [
      { ...emptyDraftLine(), item: 'rent', label: 'Loyer', amount: '1800', frequency: 'monthly', dayOfMonth: '1', category: '' },
      { ...emptyDraftLine(), item: 'other', label: 'Gym', amount: '45', frequency: 'semimonthly', day1: '1', day2: '15', category: 'Health & Personal' },
    ],
  });

  it('reads fr-CA amounts exactly, names a blank pay, and sends only the fields each line needs', () => {
    const r = firstSessionRequestFromDraft(draft(), TODAY, (n) => `Paie ${n}`);
    expect(r).toEqual({
      ok: true,
      value: {
        incomes: [{ label: 'Paie 1', amount: 2100.5, frequency: 'biweekly', nextDate: '2026-10-09' }],
        openingBalance: -1250,
        bills: [
          { item: 'rent', label: 'Loyer', amount: 1800, frequency: 'monthly', dayOfMonth: 1 },
          { item: 'other', label: 'Gym', amount: 45, category: 'Health & Personal', frequency: 'semimonthly', days: [1, 15] },
        ],
      },
    });
  });

  it('a blank, unreadable or grouped field is a problem at that line, not a zero or a guess', () => {
    const d = draft();
    d.incomes[0].amount = '2 100,50';
    d.bills[0].dayOfMonth = '';
    d.openingBalance = 'lots';
    const r = firstSessionRequestFromDraft(d, TODAY, (n) => `Pay ${n}`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toEqual([
        { section: 'incomes', index: 0, code: 'amount_invalid' },
        { section: 'bills', index: 0, code: 'day_of_month_invalid' },
        { section: 'openingBalance', code: 'opening_invalid' },
      ]);
    }
  });
});
