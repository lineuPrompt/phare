import { describe, it, expect, vi } from 'vitest';

// The REAL cardPlanWriter (vitest.setup.ts replaces it suite-wide with a
// forwarding double; this file opts back into the genuine module). Members
// may only read monthly_goals and card_envelope_items since launch plan 1.6,
// so the only client that may write a card's plan is the service role.

vi.unmock('@/lib/cardPlanWriter');

const ADMIN = { marker: 'service-role client' };
const createAdminClient = vi.fn(() => ADMIN);
vi.mock('@/lib/supabase-admin', () => ({ createAdminClient: () => createAdminClient() }));

describe('cardPlanWriter', () => {
  it('is the service-role client', async () => {
    const { cardPlanWriter } = await import('@/lib/cardPlanWriter');
    expect(await cardPlanWriter()).toBe(ADMIN);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });
});
