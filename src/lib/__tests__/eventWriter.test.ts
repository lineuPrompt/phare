import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The REAL eventWriter (vitest.setup.ts replaces it suite-wide with a recording
// double; this file opts back into the genuine module). Members cannot write
// `events` since launch plan 1.1, so the writer must be the service-role
// client and nothing else.
// ---------------------------------------------------------------------------

vi.unmock('@/lib/eventWriter');

const ADMIN = { marker: 'service-role client' };
const createAdminClient = vi.fn(() => ADMIN);
vi.mock('@/lib/supabase-admin', () => ({ createAdminClient: () => createAdminClient() }));

describe('eventWriter', () => {
  it('is the service-role client', async () => {
    const { eventWriter } = await import('@/lib/eventWriter');
    expect(eventWriter()).toBe(ADMIN);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });
});
