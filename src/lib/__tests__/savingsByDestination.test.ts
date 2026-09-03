/**
 * savingsByDestination — the parts must equal the whole.
 *
 * This is the feature's acceptance criterion, not a nice-to-have. A
 * breakdown that sums to something other than the headline is worse than no
 * breakdown: it teaches the household that the numbers on this screen do not
 * add up. The partition is emitted from inside the same `else` branch that
 * does the savings accumulation (dashboardHelpers.ts), and both are carried
 * in integer cents, so disagreement is structurally impossible rather than
 * merely unobserved. These tests are the proof of that, including for inputs
 * a float-based partition would get wrong.
 */

import { describe, it, expect } from 'vitest';
import { computeMonthTotals, type AccountRow, type TxRow } from '../dashboardHelpers';

const CHQ = 'chq';
const RRSP = 'rrsp-1';
const TFSA = 'tfsa-1';
const BUFFER = 'buffer-1';
const DEBT = 'debt-1';

const accounts: AccountRow[] = [
  { id: CHQ, type: 'chequing', is_sinking_fund: false },
  { id: RRSP, type: 'rrsp', is_sinking_fund: false },
  { id: TFSA, type: 'tfsa', is_sinking_fund: false },
  { id: BUFFER, type: 'savings', is_sinking_fund: true },
  { id: DEBT, type: 'debt', is_sinking_fund: false },
];

let seq = 0;
/** A chequing→destination pair, as create_transfer writes it (both sides). */
function pair(destination: string, amount: number): TxRow[] {
  const c = `c${++seq}`;
  const g = `g${seq}`;
  return [
    { id: c, amount, type: 'transfer', account_id: CHQ, transfer_peer_id: g },
    { id: g, amount, type: 'transfer', account_id: destination, transfer_peer_id: c },
  ];
}

/** A chequing-side contribution whose peer row does not exist. */
function orphan(amount: number): TxRow[] {
  return [{ id: `o${++seq}`, amount, type: 'transfer', account_id: CHQ, transfer_peer_id: null }];
}

/**
 * Sums the lines IN CENTS, and that is the exact statement — not a tolerance.
 *
 * `reduce((s, l) => s + l.amount, 0)` over the same lines returns
 * 41.129999999999995 where the total is 41.13. That gap is IEEE-754 binary
 * floating point being unable to represent 0.01 exactly; it is a property of
 * the number type, not of this partition, and NO implementation summing
 * JS floats can avoid it. The partition itself is exact: every line is
 * `cents / 100` drawn from an integer accumulator whose parts provably sum
 * to the total's accumulator.
 *
 * So the invariant is asserted where it is actually true and actually
 * matters — in cents, which is what the money is — and separately on the
 * FORMATTED values, which is what the household adds up on screen.
 */
const sumLineCents = (r: ReturnType<typeof computeMonthTotals>) =>
  r.savingsByDestination.reduce((s, l) => s + Math.round(l.amount * 100), 0);

const totalCents = (r: ReturnType<typeof computeMonthTotals>) =>
  Math.round(r.totalSavings * 100);

/** The claim the user can check with their own eyes: the printed lines add up. */
const sumDisplayed = (r: ReturnType<typeof computeMonthTotals>) =>
  r.savingsByDestination.reduce((s, l) => s + Math.round(Number(l.amount.toFixed(2)) * 100), 0);

const sumLines = (r: ReturnType<typeof computeMonthTotals>) => sumLineCents(r) / 100;

describe('the parts sum to the whole', () => {
  it('holds for a straightforward month', () => {
    const rows = [...pair(RRSP, 350), ...pair(TFSA, 200), ...pair(BUFFER, 425.52)];
    const r = computeMonthTotals(rows, accounts);
    expect(r.totalSavings).toBe(975.52);
    expect(sumLines(r)).toBe(r.totalSavings);
  });

  it('holds when a peer is missing — the Other bucket carries it', () => {
    const rows = [...pair(RRSP, 350), ...orphan(350)];
    const r = computeMonthTotals(rows, accounts);
    expect(r.totalSavings).toBe(700);
    expect(sumLines(r)).toBe(700);
    expect(r.savingsByDestination).toContainEqual({ accountId: null, amount: 350 });
  });

  it('holds when the destination account no longer exists', () => {
    // Peer row present, but its account is not in the account list.
    const rows = [...pair('deleted-account', 125), ...pair(RRSP, 175)];
    const r = computeMonthTotals(rows, accounts);
    expect(sumLines(r)).toBe(r.totalSavings);
    // It is a real destination id, so it gets its own line; the ROUTE is what
    // fails to resolve a name and folds it into Other for display.
    expect(r.savingsByDestination.find((l) => l.accountId === 'deleted-account')?.amount).toBe(125);
  });

  it('AWKWARD CENTS: values that a float partition would round apart', () => {
    // 0.01 × many, plus thirds — the classic cases where summing rounded
    // parts and rounding the summed whole diverge.
    const rows = [
      ...pair(RRSP, 33.33), ...pair(TFSA, 33.33), ...pair(BUFFER, 33.34),
      ...pair(RRSP, 0.01), ...pair(TFSA, 0.01), ...pair(BUFFER, 0.01),
      ...pair(RRSP, 0.07), ...pair(TFSA, 1.005 * 2), // 2.01
    ];
    const r = computeMonthTotals(rows, accounts);
    expect(sumLines(r)).toBe(r.totalSavings);
  });

  it('AWKWARD CENTS: 100 one-cent contributions across three destinations', () => {
    const rows: TxRow[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(...pair([RRSP, TFSA, BUFFER][i % 3], 0.01));
    }
    const r = computeMonthTotals(rows, accounts);
    expect(r.totalSavings).toBe(1);
    expect(sumLines(r)).toBe(1);
  });

  it('GENERATED: holds across 500 randomised months', () => {
    const dests = [RRSP, TFSA, BUFFER, DEBT, 'deleted-account'];
    let checked = 0;
    for (let run = 0; run < 500; run++) {
      const rows: TxRow[] = [];
      const n = 1 + ((run * 7) % 25);
      for (let i = 0; i < n; i++) {
        // Deterministic pseudo-random cents, so a failure is reproducible.
        const cents = ((run * 31 + i * 17) % 9973) + 1;
        const amount = cents / 100;
        const pick = (run + i) % 7;
        if (pick === 5) rows.push(...orphan(amount));
        else if (pick === 6) rows.push({ id: `d${run}_${i}`, amount, type: 'expense', account_id: CHQ });
        else rows.push(...pair(dests[pick % dests.length], amount));
      }
      const r = computeMonthTotals(rows, accounts);
      // Exact, in cents. No tolerance.
      expect(sumLineCents(r)).toBe(totalCents(r));
      // And the values as printed on screen add up to the printed headline.
      expect(sumDisplayed(r)).toBe(totalCents(r));
      checked++;
    }
    expect(checked).toBe(500);
  });
});

describe('what the breakdown must NOT contain', () => {
  it('excludes debt payments — they are their own bucket', () => {
    const rows = [...pair(DEBT, 500), ...pair(RRSP, 100)];
    const r = computeMonthTotals(rows, accounts);
    expect(r.totalDebtPayments).toBe(500);
    expect(r.totalSavings).toBe(100);
    expect(r.savingsByDestination).toEqual([{ accountId: RRSP, amount: 100 }]);
  });

  it('excludes a debt draw — borrowed cash is not saving', () => {
    const rows = [
      { id: 'x1', amount: -800, type: 'transfer', account_id: CHQ, transfer_peer_id: 'x2' },
      { id: 'x2', amount: -800, type: 'transfer', account_id: DEBT, transfer_peer_id: 'x1' },
      ...pair(RRSP, 175),
    ];
    const r = computeMonthTotals(rows, accounts);
    expect(r.totalBorrowed).toBe(800);
    expect(r.savingsByDestination).toEqual([{ accountId: RRSP, amount: 175 }]);
    expect(sumLines(r)).toBe(r.totalSavings);
  });

  it('excludes an opening balance — one-sided, and never on chequing', () => {
    const rows: TxRow[] = [
      { id: 'ob', amount: 110, type: 'transfer', account_id: TFSA, transfer_peer_id: null },
      ...pair(RRSP, 175),
    ];
    const r = computeMonthTotals(rows, accounts);
    expect(r.totalSavings).toBe(175);
    expect(r.savingsByDestination).toEqual([{ accountId: RRSP, amount: 175 }]);
  });

  it('excludes the goal-side row of a pair — only the chequing side counts', () => {
    const r = computeMonthTotals(pair(RRSP, 175), accounts);
    expect(r.savingsByDestination).toHaveLength(1);
    expect(r.totalSavings).toBe(175);
  });
});

describe('ordering', () => {
  it('largest first, with Other always last regardless of size', () => {
    const rows = [...pair(RRSP, 10), ...pair(TFSA, 300), ...orphan(9999)];
    const r = computeMonthTotals(rows, accounts);
    expect(r.savingsByDestination.map((l) => l.accountId)).toEqual([TFSA, RRSP, null]);
  });
});
