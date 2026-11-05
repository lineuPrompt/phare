import { describe, it, expect, vi } from 'vitest';
import { loadReserveFund, parseReserveFund } from '../lib/reserveFund';

// GET /api/sinking-funds, started (the route's real shape, trimmed).
const started = {
  funds: [
    { id: 'sf-1', name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 3, active: true },
    { id: 'sf-2', name: 'Christmas', annual_amount: '1200.50', monthly_provision: '100.04', due_month: 12, active: false },
  ],
  buffer: {
    linkedAccountId: 'buffer-1', balance: 408, fundedAlready: true, totalMonthlyProvision: 300,
    contributionAmount: 708, cadence: 'monthly', secondDay: null, anchorDate: '2026-07-01',
    recurringItemId: 'ri-1', nextContributionDate: '2026-12-01',
  },
};

describe('parseReserveFund', () => {
  it('reads the server\'s balance, contribution and funds as they are', () => {
    const r = parseReserveFund(started);
    expect(r.accountId).toBe('buffer-1');
    expect(r.balance).toBe(408);
    expect(r.contribution).toEqual({ amount: 708, cadence: 'monthly', nextDate: '2026-12-01' });
    expect(r.funds).toEqual([
      { id: 'sf-1', name: 'Property tax', annual: 3600, monthly: 300, active: true },
      { id: 'sf-2', name: 'Christmas', annual: 1200.5, monthly: 100.04, active: false },
    ]);
  });

  it('a fund the server sends without `active` counts as active', () => {
    const r = parseReserveFund({ ...started, funds: [{ id: 'sf-1', name: 'Tax', annual_amount: 12, monthly_provision: 1 }] });
    expect(r.funds[0].active).toBe(true);
  });

  it('not started: no account, no balance, no contribution, funds still listed', () => {
    const r = parseReserveFund({
      funds: started.funds,
      buffer: { linkedAccountId: null, balance: 0, contributionAmount: null, cadence: null, nextContributionDate: null },
    });
    expect(r.accountId).toBeNull();
    expect(r.contribution).toBeNull();
    expect(r.funds).toHaveLength(2);
  });

  it('not started: a stray contribution is not shown without an account', () => {
    const r = parseReserveFund({ funds: [], buffer: { ...started.buffer, linkedAccountId: null } });
    expect(r.contribution).toBeNull();
    expect(r.balance).toBe(0);
  });

  it('started with no contribution rule', () => {
    const r = parseReserveFund({ ...started, buffer: { ...started.buffer, contributionAmount: null, cadence: null, nextContributionDate: null } });
    expect(r.contribution).toBeNull();
    expect(r.balance).toBe(408);
  });

  it('an unknown cadence is not shown as a contribution', () => {
    const r = parseReserveFund({ ...started, buffer: { ...started.buffer, cadence: 'yearly' } });
    expect(r.contribution).toBeNull();
  });

  it('refuses a missing or non-numeric figure instead of showing $0', () => {
    expect(() => parseReserveFund({ ...started, buffer: { ...started.buffer, balance: null } })).toThrow(/balance is not a number/);
    expect(() => parseReserveFund({ ...started, funds: [{ id: 'x', name: 'x', annual_amount: 'abc', monthly_provision: 1 }] })).toThrow(/yearly amount/);
    expect(() => parseReserveFund({ ...started, funds: [{ id: 'x', name: 'x', annual_amount: 1, monthly_provision: undefined }] })).toThrow(/monthly amount/);
    expect(() => parseReserveFund({ ...started, buffer: { ...started.buffer, contributionAmount: 'n/a' } })).toThrow(/contribution/);
  });

  it('refuses an answer without funds or buffer, or a fund without an id', () => {
    expect(() => parseReserveFund({ funds: [] })).toThrow(/no funds or buffer/);
    expect(() => parseReserveFund({ buffer: {} })).toThrow(/no funds or buffer/);
    expect(() => parseReserveFund(null)).toThrow(/no funds or buffer/);
    expect(() => parseReserveFund({ ...started, funds: [{ name: 'x', annual_amount: 1, monthly_provision: 1 }] })).toThrow(/no id/);
  });
});

describe('loadReserveFund', () => {
  it('reads the sinking-funds route', async () => {
    const get = vi.fn().mockResolvedValue(started);
    await expect(loadReserveFund(get)).resolves.toMatchObject({ accountId: 'buffer-1' });
    expect(get).toHaveBeenCalledWith('/api/sinking-funds');
  });
});
