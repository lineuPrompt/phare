import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitClientEvent, validateClientEvent } from '@/lib/clientEvents';

// The web emitter stamps platform: 'web' on every event, so the server's
// required-platform check can never refuse a web call site that forgot it.
describe('emitClientEvent', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function capture() {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchMock);
    return () => fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body));
  }

  it('adds platform web to an event with no other metadata, and to one with some', () => {
    const bodies = capture();
    emitClientEvent('onboarding_entry_viewed');
    emitClientEvent('onboarding_path_chosen', { path: 'manual' });
    expect(bodies()).toEqual([
      { type: 'onboarding_entry_viewed', metadata: { platform: 'web' } },
      { type: 'onboarding_path_chosen', metadata: { path: 'manual', platform: 'web' } },
    ]);
  });

  it('everything it sends passes the server\'s own validator', () => {
    const bodies = capture();
    emitClientEvent('onboarding_template_downloaded');
    emitClientEvent('onboarding_step_reached', { step: 'accounts' });
    for (const body of bodies()) expect(validateClientEvent(body).ok).toBe(true);
  });
});
