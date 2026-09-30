import { describe, it, expect, vi } from 'vitest';
import { stepEntered } from '@phare/core';
import { createFunnelEmitter, MOBILE_STEP_OF } from '../lib/funnelEvents';

// The app's onboarding funnel events: the same POST /api/events bodies the web
// page sends, fire-and-forget. 2026-09-29.

describe('createFunnelEmitter', () => {
  it('posts the event to /api/events, stamped platform: mobile', () => {
    const post = vi.fn(() => Promise.resolve());
    const emit = createFunnelEmitter(post);
    emit({ type: 'onboarding_step_reached', metadata: { step: 'accounts' } });
    emit({ type: 'onboarding_entry_viewed' });
    expect(post.mock.calls).toEqual([
      ['/api/events', { type: 'onboarding_step_reached', metadata: { step: 'accounts', platform: 'mobile' } }],
      ['/api/events', { type: 'onboarding_entry_viewed', metadata: { platform: 'mobile' } }],
    ]);
  });

  it('never throws and never rejects, whatever the transport does', async () => {
    const rejecting = createFunnelEmitter(() => Promise.reject(new Error('offline')));
    const throwing = createFunnelEmitter(() => { throw new Error('no session'); });
    expect(rejecting({ type: 'onboarding_entry_viewed' })).toBeUndefined();
    expect(throwing({ type: 'onboarding_entry_viewed' })).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run here
  });
});

describe('MOBILE_STEP_OF — the onboarding screen\'s funnel steps', () => {
  function stepsAlong(names: string[]) {
    const out: string[] = [];
    let prev: string | null = null;
    for (const name of names) {
      const step = stepEntered(prev, name, MOBILE_STEP_OF);
      if (step) out.push(step);
      prev = name;
    }
    return out;
  }

  it('form → plausibility → form → plausibility → accounts → working → payDates → done', () => {
    expect(stepsAlong(['form', 'plausibility', 'form', 'plausibility', 'accounts', 'working', 'working', 'payDates', 'done']))
      .toEqual(['plausibility', 'plausibility', 'accounts', 'anchor_dates']);
  });

  it('the planError screen is the accounts screen with an error, not a new arrival', () => {
    expect(stepsAlong(['form', 'accounts', 'working', 'planError'])).toEqual(['accounts']);
  });
});
