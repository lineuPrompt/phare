import { describe, it, expect } from 'vitest';
import { monthlyIncomeEquivalent, resolveMemberId } from '../incomeHelpers';

describe('monthlyIncomeEquivalent', () => {
  it('weekly: multiplies by 52/12', () => {
    expect(monthlyIncomeEquivalent(1000, 'weekly')).toBe(4333.33);
  });

  it('biweekly: multiplies by 26/12 (not 2)', () => {
    // 2397.85 × 26 / 12 = 5195.3416... → 5195.34
    expect(monthlyIncomeEquivalent(2397.85, 'biweekly')).toBe(5195.34);
  });

  it('biweekly is distinct from semimonthly', () => {
    // biweekly $2000 = $4333.33/mo; semimonthly $2000 = $4000/mo — different
    const biweekly = monthlyIncomeEquivalent(2000, 'biweekly');
    const semimonthly = monthlyIncomeEquivalent(2000, 'semimonthly');
    expect(biweekly).not.toBe(semimonthly);
    expect(biweekly).toBe(4333.33);
    expect(semimonthly).toBe(4000);
  });

  it('semimonthly: multiplies by 2 exactly', () => {
    expect(monthlyIncomeEquivalent(2500, 'semimonthly')).toBe(5000);
  });

  it('monthly: returns the amount unchanged', () => {
    expect(monthlyIncomeEquivalent(3000, 'monthly')).toBe(3000);
  });

  it('rounds to two decimal places', () => {
    // 1000 × 52 / 12 = 4333.333... → 4333.33
    const result = monthlyIncomeEquivalent(1000, 'weekly');
    expect(result.toString()).not.toContain('333333');
    expect(result).toBe(4333.33);
  });

  it('weekly: known value cross-check', () => {
    // $500/week → $500 × 52 / 12 = $2166.67
    expect(monthlyIncomeEquivalent(500, 'weekly')).toBe(2166.67);
  });

  it('biweekly: $5000 paycheque → $10833.33/month', () => {
    expect(monthlyIncomeEquivalent(5000, 'biweekly')).toBe(10833.33);
  });

  it('handles zero', () => {
    expect(monthlyIncomeEquivalent(0, 'biweekly')).toBe(0);
  });
});

describe('resolveMemberId', () => {
  const members = [
    { id: 'm1', name: 'Lineu' },
    { id: 'm2', name: 'Julia' },
  ];

  it('matches an exact name', () => {
    const result = resolveMemberId('Lineu', members, 'fallback');
    expect(result).toEqual({ memberId: 'm1', usedFallback: false, unmatchedName: null });
  });

  it('matches case- and whitespace-insensitively', () => {
    const result = resolveMemberId('  julia  ', members, 'fallback');
    expect(result).toEqual({ memberId: 'm2', usedFallback: false, unmatchedName: null });
  });

  it('falls back and reports the unmatched name when the name does not match anyone', () => {
    const result = resolveMemberId('Someone Else', members, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: 'Someone Else' });
  });

  it('falls back silently-to-the-caller-but-flagged when no name was given at all', () => {
    const result = resolveMemberId(undefined, members, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: null });
  });

  it('falls back on an empty/whitespace-only name', () => {
    const result = resolveMemberId('   ', members, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: null });
  });

  it('fallback can be null (no household member row for the current user)', () => {
    const result = resolveMemberId(undefined, members, null);
    expect(result.memberId).toBeNull();
    expect(result.usedFallback).toBe(true);
  });
});
