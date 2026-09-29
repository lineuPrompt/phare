import { describe, it, expect } from 'vitest';
import { stepEntered } from '@phare/core';
import { WEB_STEP_OF, type UploadPageStatus } from '@/lib/onboardingFunnelWeb';

// The /upload page fires onboarding_step_reached from stepEntered(previous,
// status, WEB_STEP_OF) on every status change. These are the journeys that
// map produces.
function stepsAlong(path: UploadPageStatus[]) {
  const out: string[] = [];
  let prev: UploadPageStatus | null = null;
  for (const status of path) {
    const step = stepEntered(prev, status, WEB_STEP_OF);
    if (step) out.push(step);
    prev = status;
  }
  return out;
}

describe('WEB_STEP_OF — the /upload page\'s funnel steps', () => {
  it('template lane with a new member and a plausibility warning, then pay dates', () => {
    expect(stepsAlong(['idle', 'uploading', 'member_confirm', 'plausibility_check', 'accounts', 'analyzing', 'plan', 'anchor_dates', 'plan']))
      .toEqual(['member_confirm', 'plausibility', 'accounts', 'anchor_dates']);
  });

  it('manual lane, corrected once at the plausibility check', () => {
    expect(stepsAlong(['idle', 'form', 'plausibility_check', 'form', 'plausibility_check', 'accounts', 'analyzing', 'plan']))
      .toEqual(['plausibility', 'plausibility', 'accounts']);
  });

  it('loading, error and plan screens are never steps', () => {
    expect(stepsAlong(['idle', 'uploading', 'error', 'idle', 'form', 'analyzing', 'plan'])).toEqual([]);
  });
});
