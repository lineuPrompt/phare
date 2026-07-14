import { describe, it, expect } from 'vitest';
import { validateNextPayDate, validateSemimonthlyDays, buildSemimonthlyAnchor, evaluateSkipConfirmation, dropResolvedItems, selectBatchSaveable, summarizeBatchResult } from '../anchorDateHelpers';

describe('validateNextPayDate', () => {
  it('accepts a biweekly payday exactly 14 days out', () => {
    expect(validateNextPayDate('2026-07-15', 'biweekly', '2026-07-01')).toEqual({ ok: true });
  });

  it('accepts a biweekly payday today', () => {
    expect(validateNextPayDate('2026-07-01', 'biweekly', '2026-07-01')).toEqual({ ok: true });
  });

  it('rejects a biweekly payday 15 days out (past the 14-day window)', () => {
    expect(validateNextPayDate('2026-07-16', 'biweekly', '2026-07-01')).toEqual({ ok: false, error: 'tooFar' });
  });

  it('rejects a biweekly payday in the past', () => {
    expect(validateNextPayDate('2026-06-30', 'biweekly', '2026-07-01')).toEqual({ ok: false, error: 'past' });
  });

  it('accepts a weekly payday exactly 7 days out', () => {
    expect(validateNextPayDate('2026-07-08', 'weekly', '2026-07-01')).toEqual({ ok: true });
  });

  it('rejects a weekly payday 8 days out (past the 7-day window)', () => {
    expect(validateNextPayDate('2026-07-09', 'weekly', '2026-07-01')).toEqual({ ok: false, error: 'tooFar' });
  });

  it('rejects a weekly payday in the past', () => {
    expect(validateNextPayDate('2026-06-30', 'weekly', '2026-07-01')).toEqual({ ok: false, error: 'past' });
  });
});

describe('validateSemimonthlyDays', () => {
  it('accepts two distinct valid days', () => {
    expect(validateSemimonthlyDays(15, 30)).toEqual({ ok: true });
  });

  it('accepts day 31 (clamping happens at materialization, not here)', () => {
    expect(validateSemimonthlyDays(1, 31)).toEqual({ ok: true });
  });

  it('rejects day 0', () => {
    expect(validateSemimonthlyDays(0, 15)).toEqual({ ok: false, error: 'range' });
  });

  it('rejects day 32', () => {
    expect(validateSemimonthlyDays(15, 32)).toEqual({ ok: false, error: 'range' });
  });

  it('rejects non-integer days', () => {
    expect(validateSemimonthlyDays(15.5, 30)).toEqual({ ok: false, error: 'range' });
  });

  it('rejects two identical days', () => {
    expect(validateSemimonthlyDays(15, 15)).toEqual({ ok: false, error: 'same' });
  });
});

describe('buildSemimonthlyAnchor', () => {
  it('puts the earlier day in anchor_date and the later in secondDay, regardless of input order', () => {
    expect(buildSemimonthlyAnchor('2026-07', 15, 30)).toEqual({ anchorDate: '2026-07-15', secondDay: 30 });
    expect(buildSemimonthlyAnchor('2026-07', 30, 15)).toEqual({ anchorDate: '2026-07-15', secondDay: 30 });
  });

  it('clamps day 31 to the last day in a 30-day month', () => {
    expect(buildSemimonthlyAnchor('2026-04', 1, 31)).toEqual({ anchorDate: '2026-04-01', secondDay: 31 });
  });

  it('clamps the anchor day itself when it is the larger, short-month value', () => {
    // Picking 30 & 31 in a 30-day month: anchor (30) needs clamping to 30 (no-op here),
    // but in February both would need clamping.
    expect(buildSemimonthlyAnchor('2026-02', 30, 31)).toEqual({ anchorDate: '2026-02-28', secondDay: 31 });
  });
});

describe('evaluateSkipConfirmation', () => {
  it('is not needed for an empty list', () => {
    expect(evaluateSkipConfirmation([])).toEqual({ needed: false });
  });

  it('is not needed once every item has a real date', () => {
    const items = [
      { type: 'income' as const, isSet: true },
      { type: 'expense' as const, isSet: true },
    ];
    expect(evaluateSkipConfirmation(items)).toEqual({ needed: false });
  });

  it('is needed when any item is unset, and counts unset income/expense independently', () => {
    const items = [
      { type: 'income' as const, isSet: false },
      { type: 'income' as const, isSet: true },   // already set — not counted
      { type: 'expense' as const, isSet: false },
      { type: 'expense' as const, isSet: false },
    ];
    expect(evaluateSkipConfirmation(items)).toEqual({
      needed: true,
      unsetIncomeCount: 1,
      unsetExpenseCount: 2,
    });
  });

  it('counts zero for a type with no unset items, without needing it to be absent entirely', () => {
    const items = [
      { type: 'income' as const, isSet: true },
      { type: 'expense' as const, isSet: false },
    ];
    expect(evaluateSkipConfirmation(items)).toEqual({
      needed: true,
      unsetIncomeCount: 0,
      unsetExpenseCount: 1,
    });
  });
});

describe('dropResolvedItems', () => {
  it('removes every item once all of them are resolved — the all-anchored case', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(dropResolvedItems(items, ['a', 'b'])).toEqual([]);
  });

  it('keeps items not in the resolved list — a skipped/declined one stays counted', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dropResolvedItems(items, ['a', 'c'])).toEqual([{ id: 'b' }]);
  });

  it('is a no-op when nothing was resolved', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(dropResolvedItems(items, [])).toEqual(items);
  });

  it('is a no-op on an empty list', () => {
    expect(dropResolvedItems([], ['a'])).toEqual([]);
  });

  it('ignores resolved ids that are not present in the list', () => {
    const items = [{ id: 'a' }];
    expect(dropResolvedItems(items, ['does-not-exist'])).toEqual(items);
  });
});

describe('selectBatchSaveable', () => {
  const items = [
    { id: 'a', cadence: 'biweekly' },
    { id: 'b', cadence: 'semimonthly' },
    { id: 'c', cadence: 'weekly' },
  ];

  it('includes a weekly/biweekly item once nextPayDate is filled in', () => {
    const state = {
      a: { status: 'idle', nextPayDate: '2026-07-15', day1: '', day2: '' },
      b: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
      c: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
    };
    expect(selectBatchSaveable(items, state).map((i) => i.id)).toEqual(['a']);
  });

  it('requires BOTH semimonthly days to be filled in, not just one', () => {
    const state = {
      a: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
      b: { status: 'idle', nextPayDate: '', day1: '15', day2: '' },
      c: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
    };
    expect(selectBatchSaveable(items, state)).toEqual([]);

    const stateBothFilled = { ...state, b: { status: 'idle', nextPayDate: '', day1: '15', day2: '30' } };
    expect(selectBatchSaveable(items, stateBothFilled).map((i) => i.id)).toEqual(['b']);
  });

  it('excludes an item already saved, even if its fields are filled in', () => {
    const state = {
      a: { status: 'saved', nextPayDate: '2026-07-15', day1: '', day2: '' },
      b: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
      c: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
    };
    expect(selectBatchSaveable(items, state)).toEqual([]);
  });

  it('excludes blank items — they still flow to the skip-confirmation, never silently submitted', () => {
    const state = {
      a: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
      b: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
      c: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
    };
    expect(selectBatchSaveable(items, state)).toEqual([]);
  });

  it('a whitespace-only value counts as blank, not filled', () => {
    const state = {
      a: { status: 'idle', nextPayDate: '   ', day1: '', day2: '' },
      b: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
      c: { status: 'idle', nextPayDate: '', day1: '', day2: '' },
    };
    expect(selectBatchSaveable(items, state)).toEqual([]);
  });

  it('selects multiple ready items at once, preserving their order', () => {
    const state = {
      a: { status: 'idle', nextPayDate: '2026-07-15', day1: '', day2: '' },
      b: { status: 'idle', nextPayDate: '', day1: '15', day2: '30' },
      c: { status: 'idle', nextPayDate: '2026-07-08', day1: '', day2: '' },
    };
    expect(selectBatchSaveable(items, state).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('summarizeBatchResult', () => {
  it('tallies saved and failed independently — one failure does not hide the others\' success', () => {
    expect(summarizeBatchResult(['saved', 'error', 'saved', 'saved', 'error'])).toEqual({ saved: 3, failed: 2 });
  });

  it('is all-zero for an empty batch', () => {
    expect(summarizeBatchResult([])).toEqual({ saved: 0, failed: 0 });
  });

  it('reports a clean all-saved batch', () => {
    expect(summarizeBatchResult(['saved', 'saved'])).toEqual({ saved: 2, failed: 0 });
  });
});
