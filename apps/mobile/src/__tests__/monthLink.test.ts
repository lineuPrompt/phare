import { describe, it, expect } from 'vitest';
import { monthLinkParams, requestedMonth } from '../lib/monthLink';

const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11'];

describe('monthLinkParams', () => {
  it('carries the month and when it was tapped', () => {
    expect(monthLinkParams('2026-09', () => 1760000000000)).toEqual({ month: '2026-09', at: '1760000000000' });
  });
});

describe('requestedMonth', () => {
  it('jumps to a month in this screen’s range', () => {
    expect(requestedMonth({ month: '2026-09', at: '1' }, MONTHS, null)).toBe('2026-09');
  });

  it('ignores a month outside this screen’s range, so the screen stays where it is', () => {
    expect(requestedMonth({ month: '2026-07', at: '1' }, MONTHS, null)).toBeNull();
    expect(requestedMonth({ month: '2027-09', at: '1' }, MONTHS, null)).toBeNull();
  });

  it('applies one tap once: the same `at` again is not a new request', () => {
    expect(requestedMonth({ month: '2026-09', at: '1' }, MONTHS, '1')).toBeNull();
  });

  it('the same month tapped again later IS a new request', () => {
    expect(requestedMonth({ month: '2026-09', at: '2' }, MONTHS, '1')).toBe('2026-09');
  });

  it('nothing to do without params, or without `at`', () => {
    expect(requestedMonth({}, MONTHS, null)).toBeNull();
    expect(requestedMonth({ month: '2026-09' }, MONTHS, null)).toBeNull();
  });

  it('refuses anything that is not a YYYY-MM month', () => {
    expect(requestedMonth({ month: '2026-9', at: '1' }, ['2026-9'], null)).toBeNull();
  });

  it('reads the first value when the router hands over an array', () => {
    expect(requestedMonth({ month: ['2026-10', '2026-11'], at: ['3'] }, MONTHS, null)).toBe('2026-10');
  });
});
