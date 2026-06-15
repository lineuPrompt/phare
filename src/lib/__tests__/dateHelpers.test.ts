import { describe, it, expect } from 'vitest';
import { monthNameToNumber } from '../dateHelpers';

describe('monthNameToNumber', () => {
  it('maps English month names', () => {
    expect(monthNameToNumber('January')).toBe(1);
    expect(monthNameToNumber('June')).toBe(6);
    expect(monthNameToNumber('December')).toBe(12);
  });

  it('maps French month names', () => {
    expect(monthNameToNumber('janvier')).toBe(1);
    expect(monthNameToNumber('juin')).toBe(6);
    expect(monthNameToNumber('décembre')).toBe(12);
  });

  it('handles accented French months', () => {
    expect(monthNameToNumber('février')).toBe(2);
    expect(monthNameToNumber('août')).toBe(8);
  });

  it('is case-insensitive', () => {
    expect(monthNameToNumber('MARCH')).toBe(3);
    expect(monthNameToNumber('AoÛt')).toBe(8);
  });

  it('matches a month inside a longer string', () => {
    expect(monthNameToNumber('Due in September')).toBe(9);
    expect(monthNameToNumber('April 30 (CRA deadline)')).toBe(4);
  });

  it('returns the FIRST month when several are present', () => {
    expect(monthNameToNumber('March & June')).toBe(3);
  });

  it('returns null for unrecognized input', () => {
    expect(monthNameToNumber('Ongoing')).toBeNull();
    expect(monthNameToNumber('Varies')).toBeNull();
    expect(monthNameToNumber('')).toBeNull();
  });

  it('handles null/undefined-ish input safely', () => {
    expect(monthNameToNumber(null as unknown as string)).toBeNull();
    expect(monthNameToNumber(undefined as unknown as string)).toBeNull();
  });
});