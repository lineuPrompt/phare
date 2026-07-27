import { describe, it, expect } from 'vitest';
import {
  computeSinkingFundUrgency,
  rankFundingNeeds,
  computeTypicalSurplus,
  computeInsufficientHistory,
  computeOverTargetCategories,
  selectTopOverTargetCategory,
  computeFreedCapacityEvents,
  groupInstallmentSeries,
  computeStartingContribution,
  coachingFallbackApplies,
  findUnsanctionedSourcingMention,
  buildFallbackReviewText,
  containsIllustrativeTokenLeak,
  FundingNeed,
} from '../coachingHelpers';

describe('computeSinkingFundUrgency', () => {
  it('returns null monthsUntilDue when no due month is set', () => {
    expect(computeSinkingFundUrgency({ dueMonth: null, dueDay: null }, '2026-07-25').monthsUntilDue).toBeNull();
  });

  it('counts months to a later date within the same year', () => {
    expect(computeSinkingFundUrgency({ dueMonth: 12, dueDay: 15 }, '2026-07-25').monthsUntilDue).toBe(5);
  });

  it('wraps to next year when the due date already passed this year', () => {
    // Known limitation (accepted for v1): an unfunded fund whose due date
    // already passed this cycle rolls to ~12 months out, same as a fund
    // genuinely not due for a while — there's no per-fund balance to tell
    // the two apart (shared buffer architecture).
    const result = computeSinkingFundUrgency({ dueMonth: 3, dueDay: 1 }, '2026-07-25');
    expect(result.monthsUntilDue).toBe(8); // March next year
  });

  it('defaults dueDay to the 1st when unset', () => {
    const result = computeSinkingFundUrgency({ dueMonth: 7, dueDay: null }, '2026-07-01');
    expect(result.monthsUntilDue).toBe(0);
  });
});

describe('rankFundingNeeds', () => {
  it('ranks a past-due goal first regardless of a sinking fund being nearer on the calendar', () => {
    const needs: FundingNeed[] = [
      { kind: 'sinkingFundAllocation', name: 'Christmas', monthlyProvision: 300, monthsUntilDue: 1, pastDue: false },
      { kind: 'goal', name: 'Emergency fund', monthlyContribution: 400, monthsToTarget: null, pastDue: true, amountRemaining: 2400 },
    ];
    const ranked = rankFundingNeeds(needs);
    expect(ranked[0].name).toBe('Emergency fund');
  });

  it('orders by ascending months-until-due/target when nothing is past due', () => {
    const needs: FundingNeed[] = [
      { kind: 'sinkingFundAllocation', name: 'Property tax', monthlyProvision: 300, monthsUntilDue: 8, pastDue: false },
      { kind: 'goal', name: 'RESP', monthlyContribution: 200, monthsToTarget: 2, pastDue: false, amountRemaining: 400 },
      { kind: 'sinkingFundAllocation', name: 'Christmas', monthlyProvision: 258, monthsUntilDue: 4, pastDue: false },
    ];
    const ranked = rankFundingNeeds(needs);
    expect(ranked.map((n) => n.name)).toEqual(['RESP', 'Christmas', 'Property tax']);
  });

  it('breaks ties on months by larger monthly pressure first', () => {
    const needs: FundingNeed[] = [
      { kind: 'sinkingFundAllocation', name: 'Small fund', monthlyProvision: 50, monthsUntilDue: 3, pastDue: false },
      { kind: 'goal', name: 'Big goal', monthlyContribution: 500, monthsToTarget: 3, pastDue: false, amountRemaining: 1500 },
    ];
    const ranked = rankFundingNeeds(needs);
    expect(ranked[0].name).toBe('Big goal');
  });

  it('places items with no date (null months) last, ordered by pressure among themselves', () => {
    const needs: FundingNeed[] = [
      { kind: 'goal', name: 'No-date goal', monthlyContribution: 0, monthsToTarget: null, pastDue: false, amountRemaining: 1000 },
      { kind: 'sinkingFundAllocation', name: 'Dated fund', monthlyProvision: 100, monthsUntilDue: 6, pastDue: false },
    ];
    const ranked = rankFundingNeeds(needs);
    expect(ranked.map((n) => n.name)).toEqual(['Dated fund', 'No-date goal']);
  });

  it('never mutates the input array order', () => {
    const needs: FundingNeed[] = [
      { kind: 'sinkingFundAllocation', name: 'B', monthlyProvision: 100, monthsUntilDue: 5, pastDue: false },
      { kind: 'sinkingFundAllocation', name: 'A', monthlyProvision: 100, monthsUntilDue: 1, pastDue: false },
    ];
    rankFundingNeeds(needs);
    expect(needs.map((n) => n.name)).toEqual(['B', 'A']);
  });
});

describe('computeTypicalSurplus', () => {
  it('returns null for zero months of history', () => {
    expect(computeTypicalSurplus([])).toBeNull();
  });

  it('averages netCashFlow net of windfallExtra across the given months', () => {
    const result = computeTypicalSurplus([
      { month: '2026-04', netCashFlow: 1000, windfallExtra: 0 },
      { month: '2026-05', netCashFlow: 3500, windfallExtra: 2500 }, // an extra paycheque month
      { month: '2026-06', netCashFlow: 1200, windfallExtra: 0 },
    ]);
    // (1000 + 1000 + 1200) / 3
    expect(result).toEqual({ typicalSurplus: 1066.67, monthsUsed: 3 });
  });

  it('can be negative (a real trailing deficit), never clamped', () => {
    const result = computeTypicalSurplus([
      { month: '2026-04', netCashFlow: -200, windfallExtra: 0 },
    ]);
    expect(result?.typicalSurplus).toBe(-200);
  });
});

describe('computeInsufficientHistory', () => {
  it('is true when zero of the trailing months have any real data (freshly onboarded household)', () => {
    expect(computeInsufficientHistory([
      { month: '2026-04', hasRealData: false },
      { month: '2026-05', hasRealData: false },
      { month: '2026-06', hasRealData: false },
    ])).toBe(true);
  });

  it('is true when only 1 or 2 of 3 months have real data', () => {
    expect(computeInsufficientHistory([
      { month: '2026-04', hasRealData: false },
      { month: '2026-05', hasRealData: false },
      { month: '2026-06', hasRealData: true },
    ])).toBe(true);
    expect(computeInsufficientHistory([
      { month: '2026-04', hasRealData: false },
      { month: '2026-05', hasRealData: true },
      { month: '2026-06', hasRealData: true },
    ])).toBe(true);
  });

  it('is false when all 3 trailing months have real data, regardless of what that data nets to', () => {
    expect(computeInsufficientHistory([
      { month: '2026-04', hasRealData: true },
      { month: '2026-05', hasRealData: true },
      { month: '2026-06', hasRealData: true },
    ])).toBe(false);
  });

  it('is true when fewer than 3 months are supplied at all', () => {
    expect(computeInsufficientHistory([{ month: '2026-06', hasRealData: true }])).toBe(true);
  });
});

describe('computeOverTargetCategories', () => {
  it('excludes a category with no target set (target 0/unset)', () => {
    const result = computeOverTargetCategories([
      { categoryName: 'Groceries', target: 0, actual: 800 },
    ]);
    expect(result).toEqual([]);
  });

  it('excludes a category at or under its own target', () => {
    const result = computeOverTargetCategories([
      { categoryName: 'Shopping', target: 300, actual: 300 },
      { categoryName: 'Health', target: 200, actual: 150 },
    ]);
    expect(result).toEqual([]);
  });

  it('includes only a category with a real target that actual spend exceeds', () => {
    const result = computeOverTargetCategories([
      { categoryName: 'Restaurants', target: 450, actual: 680 },
      { categoryName: 'Groceries', target: 500, actual: 480 },
    ]);
    expect(result).toEqual([{ categoryName: 'Restaurants', target: 450, actual: 680, over: 230 }]);
  });
});

describe('selectTopOverTargetCategory', () => {
  it('returns null when nothing qualifies — the empty-input contract that makes fabrication impossible downstream', () => {
    expect(selectTopOverTargetCategory([])).toBeNull();
  });

  it('picks the category with the largest overspend, deterministically', () => {
    const picked = selectTopOverTargetCategory([
      { categoryName: 'Shopping', target: 200, actual: 260, over: 60 },
      { categoryName: 'Restaurants', target: 450, actual: 680, over: 230 },
    ]);
    expect(picked?.categoryName).toBe('Restaurants');
  });
});

describe('groupInstallmentSeries', () => {
  it('groups rows by recurrence_id and keeps the real last date per series', () => {
    const rows = [
      { recurrence_id: 'r1', installment_label: '1/6', description: 'Laptop', amount: 100, date: '2026-05-01' },
      { recurrence_id: 'r1', installment_label: '2/6', description: 'Laptop', amount: 100, date: '2026-06-01' },
      { recurrence_id: 'r1', installment_label: '6/6', description: 'Laptop', amount: 100, date: '2026-10-01' },
    ];
    expect(groupInstallmentSeries(rows)).toEqual([{ description: 'Laptop', amount: 100, lastDate: '2026-10-01' }]);
  });

  it('ignores a recurring-but-not-installment row (installment_label null)', () => {
    const rows = [
      { recurrence_id: 'r2', installment_label: null, description: 'Monthly gym', amount: 50, date: '2026-06-01' },
    ];
    expect(groupInstallmentSeries(rows)).toEqual([]);
  });

  it('ignores a row missing recurrence_id even if installment_label is set', () => {
    const rows = [
      { recurrence_id: null, installment_label: '1/3', description: 'Odd row', amount: 50, date: '2026-06-01' },
    ];
    expect(groupInstallmentSeries(rows)).toEqual([]);
  });
});

describe('computeFreedCapacityEvents', () => {
  it('includes the debt payoff date/amount, verbatim from computeDebtPayoff', () => {
    const events = computeFreedCapacityEvents(
      { description: 'Car loan', targetDate: '2026-10', monthlyPayment: 310 },
      []
    );
    expect(events).toEqual([{ kind: 'debtPayoff', label: 'Car loan', amount: 310, freesOn: '2026-10' }]);
  });

  it('includes only future-ending installment series (caller filters lastDate > today before calling)', () => {
    const events = computeFreedCapacityEvents(null, [
      { description: 'Laptop', amount: 100, lastDate: '2026-10-01' },
    ]);
    expect(events).toEqual([{ kind: 'endingInstallment', label: 'Laptop', amount: 100, freesOn: '2026-10-01' }]);
  });

  it('returns an empty array when there is nothing real to point to', () => {
    expect(computeFreedCapacityEvents(null, [])).toEqual([]);
  });
});

describe('computeStartingContribution', () => {
  it('never exceeds typical surplus even when the ranked need requires more', () => {
    const topNeed = { kind: 'goal' as const, name: 'RESP', monthlyContribution: 500, monthsToTarget: 6, pastDue: false, amountRemaining: 3000, monthlyPressure: 500 };
    expect(computeStartingContribution(topNeed, 180)).toBe(180);
  });

  it('caps at the need itself when surplus is larger', () => {
    const topNeed = { kind: 'sinkingFundAllocation' as const, name: 'Christmas', monthlyProvision: 300, monthsUntilDue: 4, pastDue: false as const, monthlyPressure: 300 };
    expect(computeStartingContribution(topNeed, 1240)).toBe(300);
  });

  it('is 0 when there is no ranked need or surplus is null', () => {
    expect(computeStartingContribution(null, 1000)).toBe(0);
    const topNeed = { kind: 'goal' as const, name: 'RESP', monthlyContribution: 500, monthsToTarget: 6, pastDue: false, amountRemaining: 3000, monthlyPressure: 500 };
    expect(computeStartingContribution(topNeed, null)).toBe(0);
  });

  it('never goes negative when typical surplus is a real trailing deficit', () => {
    const topNeed = { kind: 'goal' as const, name: 'RESP', monthlyContribution: 500, monthsToTarget: 6, pastDue: false, amountRemaining: 3000, monthlyPressure: 500 };
    expect(computeStartingContribution(topNeed, -200)).toBe(0);
  });
});

describe('coachingFallbackApplies', () => {
  it('is true when there is genuinely nothing to point to', () => {
    expect(coachingFallbackApplies({ typicalSurplus: 0, sourceCategory: null, freedCapacityEvents: [] })).toBe(true);
    expect(coachingFallbackApplies({ typicalSurplus: null, sourceCategory: null, freedCapacityEvents: [] })).toBe(true);
  });

  it('is false when a source category exists, even with thin surplus', () => {
    expect(coachingFallbackApplies({
      typicalSurplus: 0,
      sourceCategory: { categoryName: 'Restaurants', target: 450, actual: 680, over: 230 },
      freedCapacityEvents: [],
    })).toBe(false);
  });

  it('is false when a freed-capacity event exists, even with thin surplus', () => {
    expect(coachingFallbackApplies({
      typicalSurplus: 0,
      sourceCategory: null,
      freedCapacityEvents: [{ kind: 'debtPayoff', label: 'Car loan', amount: 310, freesOn: '2026-10' }],
    })).toBe(false);
  });

  it('is false when typical surplus is genuinely positive, even with no source/event', () => {
    expect(coachingFallbackApplies({ typicalSurplus: 180, sourceCategory: null, freedCapacityEvents: [] })).toBe(false);
  });
});

describe('findUnsanctionedSourcingMention', () => {
  const allCategories = ['Housing', 'Transportation', 'Restaurants', 'Shopping', 'Groceries & Pharmacy'];

  it('does not flag a category mentioned purely as budget narration, with no sourcing phrase nearby', () => {
    const text = 'Your spending on Shopping this month was $600, right in line with recent months.';
    expect(findUnsanctionedSourcingMention(text, allCategories, null)).toBeNull();
  });

  it('flags a disallowed category named as a money source', () => {
    const text = 'There\'s room to work with this month — that could come from Shopping if you wanted.';
    expect(findUnsanctionedSourcingMention(text, allCategories, null)).toBe('Shopping');
  });

  it('does not flag the allowed sourceCategory even when used as a source', () => {
    const text = 'Restaurants ran $680 against your own $450 target — that\'s one place it could come from.';
    expect(findUnsanctionedSourcingMention(text, allCategories, 'Restaurants')).toBeNull();
  });

  it('flags a different category as a source even when a real sourceCategory also exists', () => {
    const text = 'Restaurants ran over target, but you could also pull from Groceries & Pharmacy if needed.';
    expect(findUnsanctionedSourcingMention(text, allCategories, 'Restaurants')).toBe('Groceries & Pharmacy');
  });

  it('recognizes several sourcing phrase variants', () => {
    expect(findUnsanctionedSourcingMention('Consider directing money from Shopping toward the fund.', allCategories, null)).toBe('Shopping');
    expect(findUnsanctionedSourcingMention('You could cut back on Shopping this month.', allCategories, null)).toBe('Shopping');
    expect(findUnsanctionedSourcingMention('There\'s room in Shopping you could use.', allCategories, null)).toBe('Shopping');
  });

  it('returns null when no category is mentioned at all', () => {
    expect(findUnsanctionedSourcingMention('This was a strong month overall.', allCategories, null)).toBeNull();
  });
});

describe('buildFallbackReviewText', () => {
  it('builds an honest English fallback naming the reviewed month', () => {
    const text = buildFallbackReviewText('July 2026', 'en');
    expect(text).toContain('July 2026');
    expect(text).toContain('couldn\'t be generated safely');
  });

  it('builds an honest French fallback naming the reviewed month', () => {
    const text = buildFallbackReviewText('juillet 2026', 'fr');
    expect(text).toContain('juillet 2026');
    expect(text).toContain('pas pu être générée');
  });
});

describe('containsIllustrativeTokenLeak', () => {
  const tokens = ['name', 'month', 'need', 'freesOn'] as const;

  it('detects each enumerated token name leaking individually', () => {
    expect(containsIllustrativeTokenLeak('your plan sets aside $300/month for {name}', tokens)).toBe(true);
    expect(containsIllustrativeTokenLeak('the {month} bill is coming up', tokens)).toBe(true);
    expect(containsIllustrativeTokenLeak('that could go toward {need}', tokens)).toBe(true);
    expect(containsIllustrativeTokenLeak('once it clears in {freesOn}, that helps', tokens)).toBe(true);
  });

  it('does not flag a plain sentence with no braces at all', () => {
    expect(containsIllustrativeTokenLeak('July 2026 was a solid month overall.', tokens)).toBe(false);
  });

  it('control: a legitimate brace in prose or a user-defined category name is not a false positive', () => {
    // A brace-containing category name that is NOT one of the enumerated
    // token names — must never trigger.
    expect(containsIllustrativeTokenLeak('Your Fun {Money} category ran $50 over this month.', tokens)).toBe(false);
    // A different bracketed word entirely, not in the enumerated list.
    expect(containsIllustrativeTokenLeak('Consider putting {amount} toward savings.', tokens)).toBe(false);
  });

  it('is case-sensitive and requires an exact match — "{Name}" is not "{name}"', () => {
    expect(containsIllustrativeTokenLeak('toward {Name} this month', tokens)).toBe(false);
  });

  it('only checks the token names actually passed in — an empty list never flags anything', () => {
    expect(containsIllustrativeTokenLeak('toward {name} this month', [])).toBe(false);
  });
});
