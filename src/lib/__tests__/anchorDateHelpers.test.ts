import { describe, it, expect } from 'vitest';
import { validateNextPayDate, validateSemimonthlyDays, buildSemimonthlyAnchor, evaluateSkipConfirmation, dropResolvedItems } from '../anchorDateHelpers';

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
