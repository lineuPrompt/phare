import { describe, it, expect } from 'vitest';
import { computeBridgeInserts, type BridgeCardInfo } from '../bridgeHelpers';

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq-1';
const MEMBER = 'mem-1';

const VISA: BridgeCardInfo = { id: 'card-visa', name: 'Visa Cashback', payment_day: 15 };
const MC: BridgeCardInfo   = { id: 'card-mc',   name: 'Mastercard',    payment_day: 20 };

function base(overrides?: Partial<Parameters<typeof computeBridgeInserts>[0]>) {
  return computeBridgeInserts({
    cards: [VISA, MC],
    cardTotals: new Map([['card-visa', 120.00], ['card-mc', 75.50]]),
    existingBridgeAccounts: new Set(),
    spendMonth: '2026-06',
    chequingId: CHEQUING,
    householdId: HOUSEHOLD,
    memberId: MEMBER,
    ...overrides,
  });
}

describe('computeBridgeInserts', () => {
  it('returns one row per card with spending', () => {
    const rows = base();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.bridge_source_account)).toEqual(
      expect.arrayContaining(['card-visa', 'card-mc']),
    );
  });

  it('row fields are correct for Visa (payment_day 15)', () => {
    const rows = base();
    const visa = rows.find((r) => r.bridge_source_account === 'card-visa')!;
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
    const cardNullDay: BridgeCardInfo = { id: 'card-null', name: 'Unknown Card', payment_day: null };
    const rows = computeBridgeInserts({
      cards: [cardNullDay],
      cardTotals: new Map([['card-null', 50]]),
      existingBridgeAccounts: new Set(),
      spendMonth: '2026-06',
      chequingId: CHEQUING,
      householdId: HOUSEHOLD,
      memberId: MEMBER,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-07-01');
  });

  it('skips cards with zero spending', () => {
    const rows = base({
      cardTotals: new Map([['card-visa', 0], ['card-mc', 75.50]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].bridge_source_account).toBe('card-mc');
  });

  it('skips cards with negative spending (data anomaly — never insert negative bridge)', () => {
    const rows = base({
      cardTotals: new Map([['card-visa', -10], ['card-mc', 75.50]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].bridge_source_account).toBe('card-mc');
  });

  it('skips cards already in existingBridgeAccounts (idempotency — single call)', () => {
    const rows = base({
      existingBridgeAccounts: new Set(['card-visa']),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].bridge_source_account).toBe('card-mc');
  });

  it('idempotency: calling twice with same existing set produces empty second batch', () => {
    const firstBatch = base();
    const inserted = new Set(firstBatch.map((r) => r.bridge_source_account));

    const secondBatch = base({ existingBridgeAccounts: inserted });
    expect(secondBatch).toHaveLength(0);
  });

  it('returns empty array when all cards have zero spending', () => {
    const rows = base({
      cardTotals: new Map([['card-visa', 0], ['card-mc', 0]]),
    });
    expect(rows).toHaveLength(0);
  });

  it('returns empty array when cards array is empty', () => {
    const rows = computeBridgeInserts({
      cards: [],
      cardTotals: new Map(),
      existingBridgeAccounts: new Set(),
      spendMonth: '2026-06',
      chequingId: CHEQUING,
      householdId: HOUSEHOLD,
      memberId: MEMBER,
    });
    expect(rows).toHaveLength(0);
  });

  it('handles December spend month → January payment date', () => {
    const rows = computeBridgeInserts({
      cards: [VISA],
      cardTotals: new Map([['card-visa', 200]]),
      existingBridgeAccounts: new Set(),
      spendMonth: '2026-12',
      chequingId: CHEQUING,
      householdId: HOUSEHOLD,
      memberId: MEMBER,
    });
    expect(rows[0].date).toBe('2027-01-15');
  });

  it('member_id can be null', () => {
    const rows = base({ memberId: null });
    expect(rows.every((r) => r.member_id === null)).toBe(true);
  });

  it('existing bridge for one card does not affect the other', () => {
    const rows = base({
      existingBridgeAccounts: new Set(['card-mc']),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].bridge_source_account).toBe('card-visa');
  });
});
