import { describe, expect, it } from 'vitest';
import { balanceTodayDisplay } from '../timeline';

describe('balanceTodayDisplay', () => {
  it('headlines the start of today and adds the end of today when entries move it', () => {
    expect(balanceTodayDisplay(1654.6, 1951.36)).toEqual({ headline: 1951.36, afterToday: 1654.6 });
  });

  it('shows one figure when nothing dated today moves the balance', () => {
    expect(balanceTodayDisplay(1000, 1000)).toEqual({ headline: 1000, afterToday: null });
  });

  it('an older server (no start figure) keeps the end-of-day figure, with no second line', () => {
    expect(balanceTodayDisplay(1654.6, undefined)).toEqual({ headline: 1654.6, afterToday: null });
  });

  it('no balance for today is no figure at all, never $0', () => {
    expect(balanceTodayDisplay(null, null)).toEqual({ headline: null, afterToday: null });
  });

  it('a zero start of day is a figure, not "no data"', () => {
    expect(balanceTodayDisplay(-50, 0)).toEqual({ headline: 0, afterToday: -50 });
  });
});
