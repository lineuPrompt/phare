import { describe, it, expect } from 'vitest';
import { monthOffset, horizonLockState, type HorizonPlan } from '@/lib/horizonLock';

// The failure this guards against in BOTH directions:
//   - showing nothing where a tier boundary should be explained (a bug, to the
//     household), and
//   - showing an upgrade prompt on a month that genuinely has no data (an
//     invitation to pay for nothing).

const FREE: HorizonPlan = {
  months: [{ month: '2026-08' }, { month: '2026-09' }, { month: '2026-10' }],
  horizonMonths: 3,
  horizonAvailable: 12,
  horizonLocked: true,
};

const PRO: HorizonPlan = {
  months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(8 + i).padStart(2, '0')}` })),
  horizonMonths: 12,
  horizonAvailable: 12,
  horizonLocked: false,
};

describe('monthOffset', () => {
  it('counts whole months forward, including across a year boundary', () => {
    expect(monthOffset('2026-08', '2026-08')).toBe(0);
    expect(monthOffset('2026-08', '2026-10')).toBe(2);
    expect(monthOffset('2026-08', '2027-02')).toBe(6);
  });

  it('is negative for earlier months', () => {
    expect(monthOffset('2026-08', '2026-07')).toBe(-1);
  });

  it('returns null (not NaN) for malformed input', () => {
    // NaN would compare false everywhere and silently read as "not locked",
    // which is the same answer for the wrong reason.
    expect(monthOffset('nonsense', '2026-08')).toBeNull();
    expect(monthOffset('2026-08', '2026-8')).toBeNull();
    expect(monthOffset('', '')).toBeNull();
  });
});

describe('horizonLockState — free household', () => {
  it('a month WITH chain data is never locked', () => {
    expect(horizonLockState(FREE, '2026-09', true)).toEqual({ locked: false, remainingMonths: 0 });
  });

  it('the first withheld month is locked, and names what is behind it', () => {
    expect(horizonLockState(FREE, '2026-11', false)).toEqual({ locked: true, remainingMonths: 9 });
  });

  it('the last withheld month is still locked', () => {
    // Offset 11 — inside the computed 12, outside the returned 3.
    expect(horizonLockState(FREE, '2027-07', false)).toEqual({ locked: true, remainingMonths: 9 });
  });

  it('a month BEYOND the computed window is NOT locked — it has no data for anyone', () => {
    // Offset 12. A Pro household would see nothing here either, so an upgrade
    // prompt would be selling something that does not exist.
    expect(horizonLockState(FREE, '2027-08', false)).toEqual({ locked: false, remainingMonths: 0 });
  });

  it('a month BEFORE the window is not locked', () => {
    expect(horizonLockState(FREE, '2026-05', false)).toEqual({ locked: false, remainingMonths: 0 });
  });
});

describe('horizonLockState — never locks when it should not', () => {
  it('a PRO household is never locked, even on a month with no entry', () => {
    expect(horizonLockState(PRO, '2028-01', false)).toEqual({ locked: false, remainingMonths: 0 });
  });

  it('no plan at all is not locked', () => {
    expect(horizonLockState(null, '2026-11', false).locked).toBe(false);
    expect(horizonLockState(undefined, '2026-11', false).locked).toBe(false);
  });

  it('an empty chain is not locked', () => {
    expect(horizonLockState({ ...FREE, months: [] }, '2026-11', false).locked).toBe(false);
  });

  it('horizonLocked=false is respected even if the numbers would suggest otherwise', () => {
    // The server is the authority on whether anything was withheld.
    expect(horizonLockState({ ...FREE, horizonLocked: false }, '2026-11', false).locked).toBe(false);
  });

  it('a malformed display month is not locked', () => {
    expect(horizonLockState(FREE, 'later', false).locked).toBe(false);
  });
});
