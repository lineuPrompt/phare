import { describe, it, expect } from 'vitest';
import { loadEntitlement, type HouseholdReader } from '@/lib/entitlementServer';

// ---------------------------------------------------------------------------
// loadEntitlement reads the household row and hands it to entitlementFor. The
// fake database below answers ONLY the columns the select asked for, as
// PostgREST does — so a column missing from ENTITLEMENT_COLUMNS reads as
// absent here, exactly as it would live, and the household reads as free.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-16T12:00:00Z');

function reader(row: Record<string, unknown> | null, error: unknown = null) {
  const asked: { table: string; columns: string; id: unknown }[] = [];
  const db: HouseholdReader = {
    from(table: string) {
      let columns = '';
      let id: unknown;
      const chain = {
        select(cols: string) { columns = cols; return chain; },
        eq(_col: string, value: unknown) { id = value; return chain; },
        async single() {
          asked.push({ table, columns, id });
          if (error || !row) return { data: null, error: error ?? { message: 'no row' } };
          const wanted = columns.split(',').map((c) => c.trim());
          return { data: Object.fromEntries(wanted.filter((c) => c in row).map((c) => [c, row[c]])), error: null };
        },
      };
      return chain;
    },
  };
  return { db, asked };
}

describe('loadEntitlement', () => {
  it('reads the Apple columns, so an Apple subscriber is Pro', async () => {
    const { db, asked } = reader({
      subscription_status: 'trial',
      apple_status: 'active',
      apple_expires_at: '2026-11-16T12:00:00Z',
      apple_auto_renew: false,
    });
    expect(await loadEntitlement(db, 'hh-1', NOW)).toEqual({ isPro: true, reason: 'apple_ending' });
    expect(asked).toEqual([{ table: 'households', columns: expect.any(String), id: 'hh-1' }]);
  });

  it('reads the grace date, so Apple grace is honoured', async () => {
    const { db } = reader({ apple_status: 'grace_period', apple_grace_period_expires_at: '2026-10-20T00:00:00Z' });
    expect(await loadEntitlement(db, 'hh-1', NOW)).toEqual({ isPro: true, reason: 'apple_grace' });
  });

  it('still reads Stripe and comp', async () => {
    expect(await loadEntitlement(reader({ comp_until: '2027-01-01' }).db, 'hh', NOW)).toEqual({ isPro: true, reason: 'comp' });
    expect(await loadEntitlement(reader({
      subscription_status: 'active', subscription_current_period_end: '2026-11-01T00:00:00Z', subscription_cancel_at_period_end: true,
    }).db, 'hh', NOW)).toEqual({ isPro: true, reason: 'active_ending' });
  });

  it('fails closed when the row cannot be read — the reason the Apple migration must be live first', async () => {
    const { db } = reader(null, { message: 'column households.apple_status does not exist' });
    expect(await loadEntitlement(db, 'hh', NOW)).toEqual({ isPro: false, reason: 'none' });
  });
});
