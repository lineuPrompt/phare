import { describe, it, expect, vi } from 'vitest';
import { materializeTransferOccurrences } from '../recurringTransferHelpers';

describe('materializeTransferOccurrences', () => {
  it('calls create_transfer once per date and reports the full count on success', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const supabase = { rpc };

    const result = await materializeTransferOccurrences(supabase, {
      householdId: 'hh1',
      memberId: 'mem1',
      chequingId: 'chq1',
      destinationId: 'fund1',
      amount: 300,
      description: 'Property tax fund',
      recurringItemId: 'ri1',
      dates: ['2026-08-01', '2026-09-01', '2026-10-01'],
    });

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('create_transfer', {
      p_household_id: 'hh1',
      p_member_id: 'mem1',
      p_chequing_id: 'chq1',
      p_goal_id: 'fund1',
      p_amount: 300,
      p_date: '2026-08-01',
      p_description: 'Property tax fund',
      p_recurring_item_id: 'ri1',
    });
    expect(result).toEqual({ materialized: 3, error: null });
  });

  it('stops at the first failure and reports how many succeeded before it', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'boom' } });
    const supabase = { rpc };

    const result = await materializeTransferOccurrences(supabase, {
      householdId: 'hh1',
      memberId: 'mem1',
      chequingId: 'chq1',
      destinationId: 'fund1',
      amount: 300,
      description: 'Property tax fund',
      recurringItemId: 'ri1',
      dates: ['2026-08-01', '2026-09-01', '2026-10-01'],
    });

    expect(rpc).toHaveBeenCalledTimes(2); // stopped after the failure, never reached the third date
    expect(result).toEqual({ materialized: 1, error: 'boom' });
  });

  it('returns a generic message when the RPC error has no message', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: {} });
    const supabase = { rpc };

    const result = await materializeTransferOccurrences(supabase, {
      householdId: 'hh1', memberId: 'mem1', chequingId: 'chq1', destinationId: 'fund1',
      amount: 100, description: 'x', recurringItemId: 'ri1', dates: ['2026-08-01'],
    });

    expect(result).toEqual({ materialized: 0, error: 'Materialization failed partway through' });
  });

  it('returns zero materialized for an empty dates list', async () => {
    const rpc = vi.fn();
    const result = await materializeTransferOccurrences({ rpc }, {
      householdId: 'hh1', memberId: 'mem1', chequingId: 'chq1', destinationId: 'fund1',
      amount: 100, description: 'x', recurringItemId: 'ri1', dates: [],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ materialized: 0, error: null });
  });
});
