import { describe, it, expect } from 'vitest';
import { monthlyEquivalent, resolveMemberId, resolveMemberName } from '../incomeHelpers';

describe('monthlyEquivalent', () => {
  it('weekly: multiplies by 52/12', () => {
    expect(monthlyEquivalent(1000, 'weekly')).toBe(4333.33);
  });

  it('biweekly: multiplies by 26/12 (not 2)', () => {
    // 2397.85 × 26 / 12 = 5195.3416... → 5195.34
    expect(monthlyEquivalent(2397.85, 'biweekly')).toBe(5195.34);
  });

  it('biweekly is distinct from semimonthly', () => {
    // biweekly $2000 = $4333.33/mo; semimonthly $2000 = $4000/mo — different
    const biweekly = monthlyEquivalent(2000, 'biweekly');
    const semimonthly = monthlyEquivalent(2000, 'semimonthly');
    expect(biweekly).not.toBe(semimonthly);
    expect(biweekly).toBe(4333.33);
    expect(semimonthly).toBe(4000);
  });

  it('semimonthly: multiplies by 2 exactly', () => {
    expect(monthlyEquivalent(2500, 'semimonthly')).toBe(5000);
  });

  it('monthly: returns the amount unchanged', () => {
    expect(monthlyEquivalent(3000, 'monthly')).toBe(3000);
  });

  it('rounds to two decimal places', () => {
    // 1000 × 52 / 12 = 4333.333... → 4333.33
    const result = monthlyEquivalent(1000, 'weekly');
    expect(result.toString()).not.toContain('333333');
    expect(result).toBe(4333.33);
  });

  it('weekly: known value cross-check', () => {
    // $500/week → $500 × 52 / 12 = $2166.67
    expect(monthlyEquivalent(500, 'weekly')).toBe(2166.67);
  });

  it('biweekly: $5000 paycheque → $10833.33/month', () => {
    expect(monthlyEquivalent(5000, 'biweekly')).toBe(10833.33);
  });

  it('handles zero', () => {
    expect(monthlyEquivalent(0, 'biweekly')).toBe(0);
  });
});

describe('resolveMemberName', () => {
  const members = [
    { id: 'm1', name: 'Lineu Prompt Graeff' },
    { id: 'm2', name: 'Julia Alff' },
  ];

  it('matches a full name exactly, case/whitespace-insensitive', () => {
    expect(resolveMemberName('  julia alff  ', members)).toEqual({ kind: 'member', memberId: 'm2' });
  });

  it('matches a unique short (first) name against a full-name member', () => {
    expect(resolveMemberName('Julia', members)).toEqual({ kind: 'member', memberId: 'm2' });
    expect(resolveMemberName('Lineu', members)).toEqual({ kind: 'member', memberId: 'm1' });
  });

  it('is accent-insensitive on both the template value and the member name', () => {
    const accented = [{ id: 'm3', name: 'Renée Côté' }];
    expect(resolveMemberName('renee cote', accented)).toEqual({ kind: 'member', memberId: 'm3' });
    expect(resolveMemberName('Renée', accented)).toEqual({ kind: 'member', memberId: 'm3' });
  });

  it('never guesses between two members sharing a first name — ambiguous duplicate first names are unmatched', () => {
    const twoJulias = [
      { id: 'm2', name: 'Julia Alff' },
      { id: 'm4', name: 'Julia Ng' },
    ];
    expect(resolveMemberName('Julia', twoJulias)).toEqual({ kind: 'unmatched' });
  });

  it('reports unmatched for a truly unknown name', () => {
    expect(resolveMemberName('Marc', members)).toEqual({ kind: 'unmatched' });
  });

  it('recognizes "Household" / "Ménage" / "Ménage familial" as household-level, case/accent-insensitive', () => {
    expect(resolveMemberName('Household', members)).toEqual({ kind: 'household' });
    expect(resolveMemberName('household', members)).toEqual({ kind: 'household' });
    expect(resolveMemberName('Ménage', members)).toEqual({ kind: 'household' });
    expect(resolveMemberName('menage', members)).toEqual({ kind: 'household' });
    expect(resolveMemberName('Ménage familial', members)).toEqual({ kind: 'household' });
  });

  it('reports unmatched for an empty name', () => {
    expect(resolveMemberName('   ', members)).toEqual({ kind: 'unmatched' });
  });
});

describe('resolveMemberId', () => {
  const members = [
    { id: 'm1', name: 'Lineu Prompt Graeff' },
    { id: 'm2', name: 'Julia Alff' },
  ];

  it('matches an exact full name', () => {
    const result = resolveMemberId('Lineu Prompt Graeff', members, 'fallback');
    expect(result).toEqual({ memberId: 'm1', usedFallback: false, unmatchedName: null, isHousehold: false });
  });

  it('matches a unique short name against a full-name member, case/whitespace-insensitively', () => {
    const result = resolveMemberId('  julia  ', members, 'fallback');
    expect(result).toEqual({ memberId: 'm2', usedFallback: false, unmatchedName: null, isHousehold: false });
  });

  it('falls back and reports the unmatched name when the name does not match anyone', () => {
    const result = resolveMemberId('Someone Else', members, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: 'Someone Else', isHousehold: false });
  });

  it('falls back silently-to-the-caller-but-flagged when no name was given at all', () => {
    const result = resolveMemberId(undefined, members, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: null, isHousehold: false });
  });

  it('falls back on an empty/whitespace-only name', () => {
    const result = resolveMemberId('   ', members, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: null, isHousehold: false });
  });

  it('fallback can be null (no household member row for the current user)', () => {
    const result = resolveMemberId(undefined, members, null);
    expect(result.memberId).toBeNull();
    expect(result.usedFallback).toBe(true);
  });

  it('resolves "Household" to a null member id, not a fallback', () => {
    const result = resolveMemberId('Household', members, 'fallback');
    expect(result).toEqual({ memberId: null, usedFallback: false, unmatchedName: null, isHousehold: true });
  });

  it('resolves "Ménage" (accented) to household-level, not a fallback', () => {
    const result = resolveMemberId('Ménage', members, 'fallback');
    expect(result).toEqual({ memberId: null, usedFallback: false, unmatchedName: null, isHousehold: true });
  });

  it('two members with the same first name never resolve to a guess — falls back and is reported', () => {
    const dupes = [
      { id: 'm2', name: 'Julia Alff' },
      { id: 'm4', name: 'Julia Ng' },
    ];
    const result = resolveMemberId('Julia', dupes, 'fallback');
    expect(result).toEqual({ memberId: 'fallback', usedFallback: true, unmatchedName: 'Julia', isHousehold: false });
  });
});
