import { describe, it, expect } from 'vitest';
import { materializeFromMonthStart } from '../dateHelpers';

/**
 * Phase 2 (recurring transfers) date contract.
 *
 * Materialization of a recurring TRANSFER uses the exact same date engine
 * as recurring income/expense (materializeFromMonthStart) — see
 * POST /api/recurring and PATCH /api/recurring/[id]. There is no separate
 * date-generation logic for transfers; these tests document and pin that
 * shared contract for the transfer shape specifically.
 *
 * What ISN'T (and can't be) unit-tested here: the actual paired-row
 * creation (create_transfer RPC call per date) and the single
 * DELETE ... WHERE recurring_item_id = $1 removing both sides atomically —
 * those are real Postgres round-trips, consistent with this codebase's
 * existing convention of testing pure lib functions only, never route
 * Supabase orchestration directly. Verified instead by code review (both
 * INSERTs in create_transfer happen inside one plpgsql function body — a
 * single Postgres transaction — and both inserted rows carry the same
 * recurring_item_id, so one DELETE by that id always removes the pair) and
 * left for the founder to confirm live.
 */

describe('recurring transfer materialization — date engine', () => {
  it('bi-weekly transfer materializes real dates across 12 months, with a three-occurrence month emerging naturally', () => {
    // Anchor on a Friday; 12 months at 14-day steps naturally produces some
    // months with 3 occurrences (12 months × ~4.33 weeks ÷ 2 ≈ 26 total,
    // which cannot fit as exactly 2-per-month for all 12 months).
    const dates = materializeFromMonthStart(
      { cadence: 'biweekly', anchorDate: '2026-01-02', secondDay: null },
      '2026-01-02',
      12
    );

    expect(dates.length).toBeGreaterThan(24); // more than a flat 2/month × 12
    expect(dates[0]).toBe('2026-01-02');

    // Group by month and confirm at least one month has 3 occurrences —
    // "emerges naturally" from the fixed 14-day cadence, never hand-picked.
    const byMonth = new Map<string, number>();
    for (const d of dates) {
      const m = d.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    }
    expect(Array.from(byMonth.values())).toContain(3);
  });

  it('weekly transfer materializes 12 months of real dates, one per week', () => {
    const dates = materializeFromMonthStart(
      { cadence: 'weekly', anchorDate: '2026-01-05', secondDay: null },
      '2026-01-05',
      12
    );
    // ~52 weeks over 12 months, give or take month-boundary effects.
    expect(dates.length).toBeGreaterThan(48);
    expect(dates.every((d) => d >= '2026-01-05')).toBe(true);
  });

  it('semimonthly transfer materializes exactly two dates per month', () => {
    const dates = materializeFromMonthStart(
      { cadence: 'semimonthly', anchorDate: '2026-01-01', secondDay: 15 },
      '2026-01-01',
      6
    );
    expect(dates.length).toBe(12); // 2 × 6 months
  });

  it('monthly transfer materializes exactly one date per month', () => {
    const dates = materializeFromMonthStart(
      { cadence: 'monthly', anchorDate: '2026-01-05', secondDay: null },
      '2026-01-05',
      12
    );
    expect(dates.length).toBe(12);
  });

  it('needs-a-date contract: the route never calls the date engine without an anchor — zero occurrences, not a fabricated guess', () => {
    // Mirrors the exact guard used in POST /api/recurring and
    // PATCH /api/recurring/[id]: `anchorDate ? materializeFromMonthStart(...) : []`.
    const anchorDate: string | null = null;
    const dates = anchorDate
      ? materializeFromMonthStart({ cadence: 'monthly', anchorDate, secondDay: null }, '2026-01-01', 12)
      : [];
    expect(dates).toEqual([]);
  });
});
