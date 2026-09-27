import { describe, it, expect } from 'vitest';
import { onboardingErrorKind, afterSaveOutcome, openingAnchorValue } from '../onboarding';

// canGoToDashboard and formatResetDate moved here from the web app with their
// tests left in place (src/lib/__tests__/onboardingCompletion.test.ts,
// onboardingQuota.test.ts), which import them through the web re-export and so
// pin both the rule and the wiring. This file covers what is new in core.

describe('onboardingErrorKind — which server codes the onboarding screens name', () => {
  it.each([
    ['PAYLOAD_TOO_LARGE', 'payloadTooLarge'],
    ['AI_UNAVAILABLE', 'aiUnavailable'],
    ['RATE_LIMITED', 'rateLimited'],
    ['NOT_AUTHENTICATED', 'notAuthenticated'],
    ['ONBOARDING_QUOTA_EXHAUSTED', 'onboardingQuotaExhausted'],
  ] as const)('%s → %s', (code, kind) => {
    expect(onboardingErrorKind(code)).toBe(kind);
  });

  it.each(['INVALID_JSON', 'UNKNOWN_PLAN_SOURCE', 'PLAN_FAILED'])(
    '%s collapses to planFailed',
    (code) => {
      expect(onboardingErrorKind(code)).toBe('planFailed');
    }
  );

  it('returns null for an unrecognised code, so the caller shows the server’s own words', () => {
    expect(onboardingErrorKind('SOMETHING_NEW')).toBeNull();
  });

  it('returns null for no code at all', () => {
    expect(onboardingErrorKind(undefined)).toBeNull();
  });
});

describe('afterSaveOutcome — what a 2xx save-plan body means', () => {
  it('needsConfirmation wins, and carries the counts: nothing was written', () => {
    const counts = { totalRecurring: 4 };
    expect(afterSaveOutcome({ needsConfirmation: true, counts, needsPayDate: [{ id: 'a' }] })).toEqual({
      kind: 'needsConfirmation',
      counts,
    });
  });

  it('a save with pay dates outstanding asks for them', () => {
    const out = afterSaveOutcome({ needsPayDate: [{ id: 'a' }] });
    expect(out.kind).toBe('needsPayDate');
    expect(out).toMatchObject({ needsPayDate: [{ id: 'a' }] });
  });

  it('a save with an empty pay-date list is done', () => {
    expect(afterSaveOutcome({ needsPayDate: [] }).kind).toBe('done');
  });

  it('passes the notices through untouched', () => {
    const unmatchedMembers = [{ label: 'Salary', attemptedMember: 'Sam' }];
    const householdMembers = [{ id: 'm1', name: 'Alex' }];
    expect(afterSaveOutcome({ unmatchedMembers, householdMembers })).toEqual({
      kind: 'done',
      needsPayDate: [],
      unmatchedMembers,
      householdMembers,
    });
  });

  it('an unparseable body (null) is a save with no notices, as the web page always read it', () => {
    expect(afterSaveOutcome(null)).toEqual({
      kind: 'done',
      needsPayDate: [],
      unmatchedMembers: [],
      householdMembers: [],
    });
  });

  it('a falsy needsConfirmation is not a confirmation request', () => {
    expect(afterSaveOutcome({ needsConfirmation: false }).kind).toBe('done');
  });
});

describe('openingAnchorValue — whether to anchor chequing after the save', () => {
  it('blank means "not now": no anchor', () => {
    expect(openingAnchorValue('')).toBeNull();
    expect(openingAnchorValue('   ')).toBeNull();
  });

  it('reads a plain number, trimmed', () => {
    expect(openingAnchorValue(' 1234.56 ')).toBe(1234.56);
  });

  it('keeps a negative balance: an overdrawn account is a real anchor', () => {
    expect(openingAnchorValue('-50')).toBe(-50);
  });

  it('keeps zero: an empty account is a real anchor, not "no data"', () => {
    expect(openingAnchorValue('0')).toBe(0);
  });

  it('refuses anything Number() cannot read', () => {
    expect(openingAnchorValue('abc')).toBeNull();
    expect(openingAnchorValue('Infinity')).toBeNull();
  });
});
