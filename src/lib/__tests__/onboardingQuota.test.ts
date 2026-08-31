import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_GENERATIONS_PER_MONTH,
  PLAN_GENERATION_EVENT,
  REVIEW_GENERATION_EVENT,
  onboardingQuotaFrom,
  formatResetDate,
  resetDateFor,
} from '../onboardingQuota';

describe('the ceiling', () => {
  it('is ten per household per calendar month', () => {
    expect(ONBOARDING_GENERATIONS_PER_MONTH).toBe(10);
  });

  it('counts the two routes separately', () => {
    // Sharing one reservation would leave whichever route did not increment
    // unbounded — a script can call /api/review-stream without ever touching
    // /api/plan. Distinct event types are what stop that.
    expect(PLAN_GENERATION_EVENT).not.toBe(REVIEW_GENERATION_EVENT);
    expect(PLAN_GENERATION_EVENT).toBe('onboarding_plan_generated');
    expect(REVIEW_GENERATION_EVENT).toBe('onboarding_review_generated');
  });
});

describe('quota arithmetic at the onboarding limit', () => {
  it('allows the first generation of the month', () => {
    const q = onboardingQuotaFrom(0, '2026-08');
    expect(q).toMatchObject({ used: 0, limit: 10, remaining: 10, allowed: true });
  });

  it('allows the tenth — the boundary a re-onboarding household sits on', () => {
    const q = onboardingQuotaFrom(9, '2026-08');
    expect(q.allowed).toBe(true);
    expect(q.remaining).toBe(1);
  });

  it('refuses the eleventh', () => {
    const q = onboardingQuotaFrom(10, '2026-08');
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('refuses without wrapping when the count is somehow over', () => {
    // If a race ever let an extra through, the fix is to stop, not hand out
    // another. remaining must never go negative.
    const q = onboardingQuotaFrom(50, '2026-08');
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('reports the reset date, which is the whole point of the refusal', () => {
    expect(onboardingQuotaFrom(10, '2026-08').resetsOn).toBe('2026-09-01');
  });

  it('rolls the year at December', () => {
    expect(resetDateFor('2026-12')).toBe('2027-01-01');
  });
});

describe('formatResetDate — what the blocked household actually reads', () => {
  it('renders an English date', () => {
    expect(formatResetDate('2026-09-01', 'en')).toBe('September 1, 2026');
  });

  it('renders a French date natively', () => {
    // fr-CA is "1 septembre 2026" — no comma, lowercase month.
    expect(formatResetDate('2026-09-01', 'fr')).toBe('1 septembre 2026');
  });

  it('does not slip to the previous day in a negative-offset zone', () => {
    // new Date('2026-09-01') is MIDNIGHT UTC, which formats as August 31st in
    // every Canadian timezone. A household would be told its allowance refills
    // the day before it does. Parsing at noon UTC is what prevents that, and
    // this asserts the day number survives.
    expect(formatResetDate('2026-09-01', 'en')).toContain('1');
    expect(formatResetDate('2026-09-01', 'en')).not.toContain('August');
    expect(formatResetDate('2026-01-01', 'en')).not.toContain('December');
  });

  it('returns empty rather than "Invalid Date" for a missing or malformed value', () => {
    expect(formatResetDate(undefined, 'en')).toBe('');
    expect(formatResetDate('', 'en')).toBe('');
    expect(formatResetDate('not-a-date', 'en')).toBe('');
    expect(formatResetDate('2026-09', 'en')).toBe('');
  });
});
