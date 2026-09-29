import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  PLAUSIBILITY_ACTIONS,
  UPLOAD_REJECTION_REASONS,
  stepEntered,
  type OnboardingStep,
} from '../onboardingFunnel';

type S = 'idle' | 'form' | 'check' | 'accounts' | 'saving' | 'dates';
const STEP_OF: Partial<Record<S, OnboardingStep>> = {
  check: 'plausibility',
  accounts: 'accounts',
  dates: 'anchor_dates',
};

describe('the funnel vocabulary', () => {
  it('lists the five steps in the order a household meets them', () => {
    expect(ONBOARDING_STEPS).toEqual(['upload_parsed', 'member_confirm', 'plausibility', 'accounts', 'anchor_dates']);
  });

  it('has the two plausibility answers and the five upload refusals', () => {
    expect(PLAUSIBILITY_ACTIONS).toEqual(['confirm', 'correct']);
    expect(UPLOAD_REJECTION_REASONS).toEqual(['no_file', 'unsupported_type', 'wrong_file', 'outdated_template', 'parse_failed']);
  });
});

describe('stepEntered', () => {
  it('reports a step on entering its screen, including the very first screen', () => {
    expect(stepEntered<S>('form', 'check', STEP_OF)).toBe('plausibility');
    expect(stepEntered<S>(null, 'accounts', STEP_OF)).toBe('accounts');
  });

  it('reports nothing for a screen that is not a step', () => {
    expect(stepEntered<S>('accounts', 'saving', STEP_OF)).toBeNull();
    expect(stepEntered<S>(null, 'idle', STEP_OF)).toBeNull();
  });

  it('reports nothing when staying on the same step (a re-render)', () => {
    expect(stepEntered<S>('accounts', 'accounts', STEP_OF)).toBeNull();
  });

  it('two screen states that are the same step count once (e.g. a step shown again with an error)', () => {
    const withRetry: Partial<Record<string, OnboardingStep>> = { accounts: 'accounts', accountsRetry: 'accounts' };
    expect(stepEntered<string>('accounts', 'accountsRetry', withRetry)).toBeNull();
  });

  it('reports the step again when a household comes back to it', () => {
    // check → form (corrected) → check again is a second arrival, not a re-render.
    expect(stepEntered<S>('form', 'check', STEP_OF)).toBe('plausibility');
  });
});
