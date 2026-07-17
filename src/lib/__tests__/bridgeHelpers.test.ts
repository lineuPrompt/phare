import { describe, it, expect } from 'vitest';
import { computeBridgeSync, netCycleSpend, type BridgeCardInfo, type ExistingBridgeRow } from '../bridgeHelpers';

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq-1';
const MEMBER = 'mem-1';

const VISA: BridgeCardInfo = { id: 'card-visa', name: 'Visa Cashback', payment_day: 15, statement_close_day: null };
const MC: BridgeCardInfo   = { id: 'card-mc',   name: 'Mastercard',    payment_day: 20, statement_close_day: null };

function base(overrides?: Partial<Parameters<typeof computeBridgeSync>[0]>) {
  return computeBridgeSync({
    cards: [VISA, MC],
    cardTotals: new Map([['card-visa', 120.00], ['card-mc', 75.50]]),
    existingBridges: [],
    spendMonth: '2026-06',
    chequingId: CHEQUING,
    householdId: HOUSEHOLD,
    memberId: MEMBER,
    ...overrides,
  });
}

describe('computeBridgeSync — insert path (no existing row)', () => {
  it('inserts one row per card with spending', () => {
    const { toInsert, toUpdate, toDelete } = base();
    expect(toInsert).toHaveLength(2);
    expect(toUpdate).toHaveLength(0);
    expect(toDelete).toHaveLength(0);
    expect(toInsert.map((r) => r.bridge_source_account)).toEqual(
      expect.arrayContaining(['card-visa', 'card-mc']),
    );
  });

  it('row fields are correct for Visa (payment_day 15)', () => {
    const { toInsert } = base();
    const visa = toInsert.find((r) => r.bridge_source_account === 'card-visa')!;
    expect(visa.household_id).toBe(HOUSEHOLD);
    expect(visa.account_id).toBe(CHEQUING);
    expect(visa.member_id).toBe(MEMBER);
    expect(visa.amount).toBe(120.00);
    expect(visa.date).toBe('2026-07-15'); // spend month + 1, day 15
    expect(visa.type).toBe('expense');
    expect(visa.source).toBe('bridge');
    expect(visa.is_bridge).toBe(true);
    expect(visa.bridge_source_month).toBe('2026-06');
    expect(visa.description).toBe('Visa Cashback payment');
    expect(visa.category_id).toBeNull();
  });

  it('defaults payment date to day 1 when payment_day is null', () => {
    const cardNullDay: BridgeCardInfo = { id: 'card-null', name: 'Unknown Card', payment_day: null, statement_close_day: null };
    const { toInsert } = computeBridgeSync({
      cards: [cardNullDay],
      cardTotals: new Map([['card-null', 50]]),
      existingBridges: [],
      spendMonth: '2026-06',
      chequingId: CHEQUING,
      householdId: HOUSEHOLD,
      memberId: MEMBER,
    });
    expect(toInsert).toHaveLength(1);
    expect(toInsert[0].date).toBe('2026-07-01');
  });

  it('skips cards with zero spending (no insert, nothing to delete)', () => {
    const { toInsert } = base({
      cardTotals: new Map([['card-visa', 0], ['card-mc', 75.50]]),
    });
    expect(toInsert).toHaveLength(1);
    expect(toInsert[0].bridge_source_account).toBe('card-mc');
  });

  it('skips cards with negative spending (data anomaly — never insert negative bridge)', () => {
    const { toInsert } = base({
      cardTotals: new Map([['card-visa', -10], ['card-mc', 75.50]]),
    });
    expect(toInsert).toHaveLength(1);
    expect(toInsert[0].bridge_source_account).toBe('card-mc');
  });

  it('returns nothing when all cards have zero spending', () => {
    const { toInsert, toUpdate, toDelete } = base({
      cardTotals: new Map([['card-visa', 0], ['card-mc', 0]]),
    });
    expect(toInsert).toHaveLength(0);
    expect(toUpdate).toHaveLength(0);
    expect(toDelete).toHaveLength(0);
  });

  it('returns nothing when cards array is empty', () => {
    const result = computeBridgeSync({
      cards: [],
      cardTotals: new Map(),
      existingBridges: [],
      spendMonth: '2026-06',
      chequingId: CHEQUING,
      householdId: HOUSEHOLD,
      memberId: MEMBER,
    });
    expect(result.toInsert).toHaveLength(0);
  });

  it('handles December spend month → January payment date', () => {
    const { toInsert } = computeBridgeSync({
      cards: [VISA],
      cardTotals: new Map([['card-visa', 200]]),
      existingBridges: [],
      spendMonth: '2026-12',
      chequingId: CHEQUING,
      householdId: HOUSEHOLD,
      memberId: MEMBER,
    });
    expect(toInsert[0].date).toBe('2027-01-15');
  });

  it('member_id can be null', () => {
    const { toInsert } = base({ memberId: null });
    expect(toInsert.every((r) => r.member_id === null)).toBe(true);
  });
});

describe('computeBridgeSync — living rows (recompute on every call)', () => {
  const existingVisa: ExistingBridgeRow = { id: 'bridge-visa-1', bridge_source_account: 'card-visa', amount: 120.00 };
  const existingMc: ExistingBridgeRow = { id: 'bridge-mc-1', bridge_source_account: 'card-mc', amount: 75.50 };

  it('matching total: no insert, no update, no delete (stable state)', () => {
    const result = base({ existingBridges: [existingVisa, existingMc] });
    expect(result.toInsert).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
  });

  it('a card entry edit changes the total → existing bridge row is updated, not left stale', () => {
    const result = base({
      cardTotals: new Map([['card-visa', 200.00], ['card-mc', 75.50]]),
      existingBridges: [existingVisa, existingMc],
    });
    expect(result.toUpdate).toEqual([{ id: 'bridge-visa-1', amount: 200.00 }]);
    expect(result.toInsert).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
  });

  it('all card entries for a cycle deleted → total drops to 0 → existing bridge row is deleted', () => {
    const result = base({
      cardTotals: new Map([['card-visa', 0], ['card-mc', 75.50]]),
      existingBridges: [existingVisa, existingMc],
    });
    expect(result.toDelete).toEqual(['bridge-visa-1']);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.toInsert).toHaveLength(0);
  });

  it('a brand new entry appears on a card with no existing bridge row → insert', () => {
    const result = base({
      cardTotals: new Map([['card-visa', 120.00], ['card-mc', 75.50]]),
      existingBridges: [existingVisa], // MC has none yet
    });
    expect(result.toInsert).toHaveLength(1);
    expect(result.toInsert[0].bridge_source_account).toBe('card-mc');
    expect(result.toUpdate).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
  });

  it('re-running with the just-applied state is a stable no-op (idempotent)', () => {
    const first = base({ existingBridges: [] });
    expect(first.toInsert).toHaveLength(2);

    // Simulate the inserted rows now existing, same totals recomputed again.
    const asExisting: ExistingBridgeRow[] = first.toInsert.map((r, i) => ({
      id: `new-${i}`,
      bridge_source_account: r.bridge_source_account,
      amount: r.amount,
    }));
    const second = base({ existingBridges: asExisting });
    expect(second.toInsert).toHaveLength(0);
    expect(second.toUpdate).toHaveLength(0);
    expect(second.toDelete).toHaveLength(0);
  });

  it('existing bridge for one card is untouched by a change on the other', () => {
    const result = base({
      cardTotals: new Map([['card-visa', 120.00], ['card-mc', 90.00]]),
      existingBridges: [existingVisa, existingMc],
    });
    expect(result.toUpdate).toEqual([{ id: 'bridge-mc-1', amount: 90.00 }]);
  });
});

// ---------------------------------------------------------------------------
// Refund netting (bridges net refunds against spend, same rule as envelope
// actuals). netCycleSpend is the pure per-card, per-window net; computeBridgeSync
// already clamps any total <= 0 to "no bridge" (delete existing / insert nothing) —
// these tests confirm that clamp actually fires for a net-negative cycle.
// ---------------------------------------------------------------------------

describe('netCycleSpend — refund netting within a cycle window', () => {
  const WINDOW = { start: '2026-06-16', end: '2026-07-15' };

  it('a refund in-cycle reduces the net below raw spend', () => {
    const net = netCycleSpend(
      [
        { date: '2026-07-01', type: 'expense', amount: 100 },
        { date: '2026-07-05', type: 'income', amount: 30 }, // refund
      ],
      WINDOW
    );
    expect(net).toBe(70);
  });

  it('a refund that exceeds spend nets negative (caller clamps to zero)', () => {
    const net = netCycleSpend(
      [
        { date: '2026-07-01', type: 'expense', amount: 50 },
        { date: '2026-07-05', type: 'income', amount: 80 }, // refund exceeds spend
      ],
      WINDOW
    );
    expect(net).toBe(-30);
  });

  it('ignores transactions outside the window', () => {
    const net = netCycleSpend(
      [
        { date: '2026-07-01', type: 'expense', amount: 100 },
        { date: '2026-07-16', type: 'income', amount: 30 }, // next cycle — not netted here
      ],
      WINDOW
    );
    expect(net).toBe(100);
  });

  it('ignores transfer rows entirely', () => {
    const net = netCycleSpend(
      [
        { date: '2026-07-01', type: 'expense', amount: 100 },
        { date: '2026-07-02', type: 'transfer', amount: 500 },
      ],
      WINDOW
    );
    expect(net).toBe(100);
  });
});

describe('computeBridgeSync — refund-exceeds-spend never produces a negative payment', () => {
  it('a net-negative cycle total produces no insert (never a negative bridge)', () => {
    const result = base({
      cardTotals: new Map([['card-visa', -30], ['card-mc', 75.50]]),
      existingBridges: [],
    });
    expect(result.toInsert.map((r) => r.bridge_source_account)).not.toContain('card-visa');
    expect(result.toInsert.every((r) => r.amount > 0)).toBe(true);
  });

  it('a cycle that goes net-negative after previously having a bridge row deletes it', () => {
    const existingVisa: ExistingBridgeRow = { id: 'bridge-visa-1', bridge_source_account: 'card-visa', amount: 100 };
    const result = base({
      cardTotals: new Map([['card-visa', -30], ['card-mc', 75.50]]),
      existingBridges: [existingVisa],
    });
    expect(result.toDelete).toEqual(['bridge-visa-1']);
  });
});
