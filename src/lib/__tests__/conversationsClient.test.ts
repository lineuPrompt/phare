import { describe, it, expect, vi } from 'vitest';

// The REAL conversationsClient (vitest.setup.ts replaces it suite-wide with a
// forwarding double; this file opts back into the genuine module). Members
// have no access to `conversations` since launch plan 1.3, so the only client
// that may read or write letters is the service role.

vi.unmock('@/lib/conversationsClient');

const ADMIN = { marker: 'service-role client' };
const createAdminClient = vi.fn(() => ADMIN);
vi.mock('@/lib/supabase-admin', () => ({ createAdminClient: () => createAdminClient() }));

describe('conversationsClient', () => {
  it('is the service-role client', async () => {
    const { conversationsClient } = await import('@/lib/conversationsClient');
    expect(await conversationsClient()).toBe(ADMIN);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });
});
