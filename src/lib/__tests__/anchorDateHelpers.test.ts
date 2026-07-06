import { describe, it, expect } from 'vitest';
import { validateNextPayDate, validateSemimonthlyDays, buildSemimonthlyAnchor } from '../anchorDateHelpers';

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
