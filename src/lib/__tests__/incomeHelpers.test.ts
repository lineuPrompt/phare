import { describe, it, expect } from 'vitest';
import { monthlyIncomeEquivalent } from '../incomeHelpers';

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
