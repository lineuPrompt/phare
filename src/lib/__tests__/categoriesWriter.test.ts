import { describe, it, expect, vi } from 'vitest';

// The REAL categoriesWriter (vitest.setup.ts replaces it suite-wide with a
// forwarding double; this file opts back into the genuine module). Members
// may only read `categories` since launch plan 1.6, so the only client that
// may write them is the service role.

vi.unmock('@/lib/categoriesWriter');

const ADMIN = { marker: 'service-role client' };
const createAdminClient = vi.fn(() => ADMIN);
vi.mock('@/lib/supabase-admin', () => ({ createAdminClient: () => createAdminClient() }));

describe('categoriesWriter', () => {
  it('is the service-role client', async () => {
    const { categoriesWriter } = await import('@/lib/categoriesWriter');
    expect(await categoriesWriter()).toBe(ADMIN);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });
});
