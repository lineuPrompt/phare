import { describe, it, expect, vi } from 'vitest';
import { quotaFrom, resetDateFor, REGENERATIONS_PER_MONTH } from '@/lib/regenerationQuota';
import { readQuota, reserveRegeneration } from '@/lib/regenerationQuotaServer';

vi.mock('@/lib/householdTimezone', () => ({
  getHouseholdTimezone: async () => 'America/Toronto',
}));

describe('quotaFrom', () => {
  it('counts up to the cap', () => {
    expect(quotaFrom(0, '2026-08')).toMatchObject({ used: 0, remaining: 4, allowed: true });
    expect(quotaFrom(3, '2026-08')).toMatchObject({ used: 3, remaining: 1, allowed: true });
  });

  it('refuses AT the cap, not after it', () => {
    // Off-by-one here is the difference between selling four and giving five.
    expect(quotaFrom(4, '2026-08')).toMatchObject({ remaining: 0, allowed: false });
  });

  it('a count above the cap still refuses, and never reports negative remaining', () => {
    // If a race ever let a fifth through, the fix is to stop — not to hand out
    // a sixth because the arithmetic went negative.
    expect(quotaFrom(9, '2026-08')).toMatchObject({ remaining: 0, allowed: false });
  });

  it('treats nonsense counts as zero rather than granting infinite access', () => {
    for (const bad of [NaN, -3, Infinity * 0]) {
      expect(quotaFrom(bad as number, '2026-08').used).toBe(0);
    }
  });

  it('the advertised number is the enforced number', () => {
    // The pricing card says four. Teeth against the constant drifting.
    expect(REGENERATIONS_PER_MONTH).toBe(4);
    expect(quotaFrom(0, '2026-08').limit).toBe(4);
  });
});

describe('resetDateFor', () => {
  it('is the first of the next month', () => {
    expect(resetDateFor('2026-08')).toBe('2026-09-01');
  });

  it('rolls the year at December', () => {
    expect(resetDateFor('2026-12')).toBe('2027-01-01');
  });

  it('returns empty for malformed input rather than an invalid date', () => {
    expect(resetDateFor('nonsense')).toBe('');
  });
});

// --- server side ----------------------------------------------------------

function client({ count = 0, countError = null as unknown, insertError = null as unknown } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const c = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => ({ count, error: countError }),
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: insertError };
      },
    }),
  };
  return { c, inserts };
}

describe('readQuota', () => {
  it('reads the count for the household’s own month', async () => {
    const { c } = client({ count: 2 });
    const q = await readQuota(c, 'hh1');
    expect(q).toMatchObject({ used: 2, remaining: 2, allowed: true });
    expect(q.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('FAILS CLOSED when the count cannot be read', async () => {
    // An unreadable count must not authorise the most expensive call in the
    // app. Reported as exhausted so the caller refuses rather than guesses.
    const { c } = client({ countError: { message: 'boom' } });
    expect((await readQuota(c, 'hh1')).allowed).toBe(false);
  });
});

describe('reserveRegeneration', () => {
  it('reserves a slot and records the month on the row', async () => {
    const { c, inserts } = client({ count: 1 });
    const r = await reserveRegeneration(c, 'hh1', 'user-1');

    expect(r.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].event_type).toBe('review_regenerated');
    // The month lives on the row so counting is an equality match, not
    // timestamp arithmetic against a moving timezone boundary.
    expect((inserts[0].metadata as { month: string }).month).toMatch(/^\d{4}-\d{2}$/);
    if (r.ok) expect(r.quota.used).toBe(2);
  });

  it('refuses at the cap and writes NOTHING', async () => {
    const { c, inserts } = client({ count: 4 });
    const r = await reserveRegeneration(c, 'hh1', 'user-1');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('exhausted');
    expect(inserts).toEqual([]);
  });

  it('refuses when the reservation cannot be written', async () => {
    // A swallowed write is an uncounted regeneration, and enough of those make
    // the limit fiction — so unlike logEvent, this failure is fatal.
    const { c } = client({ count: 0, insertError: { message: 'db down' } });
    const r = await reserveRegeneration(c, 'hh1', 'user-1');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unavailable');
  });

  it('reserves BEFORE the work, so a failed generation consumes a slot', async () => {
    // Deliberate: generate-then-record would make a failing prompt retryable
    // without limit, which is exactly the cost this bounds.
    const { c, inserts } = client({ count: 0 });
    await reserveRegeneration(c, 'hh1', 'user-1');
    expect(inserts).toHaveLength(1);
  });
});
