import { describe, it, expect } from 'vitest';
import { buildCashTimeline, selectAnchorsForTimeline, TimelineAnchor, TimelineTx } from '../timelineHelpers';

// ── Factories ─────────────────────────────────────────────────────────────────

let _id = 0;
function tx(
  overrides: Partial<TimelineTx> & { date: string; amount: number; type: 'income' | 'expense' | 'transfer' }
): TimelineTx {
  return {
    id: `tx-${++_id}`,
    description: null,
    recurringItemId: null,
    recurrenceId: null,
    installmentLabel: null,
    transferPeerId: null,
    isBridge: false,
    bridgeSourceAccount: null,
    ...overrides,
  };
}

function anchor(date: string, balance: number): TimelineAnchor {
  return { date, balance };
}

// ── 1. No anchor — refuse visibly ────────────────────────────────────────────

describe('buildCashTimeline — no anchor', () => {
  it('returns { ok: false, reason: "no_anchor" } when anchors is empty', () => {
    const result = buildCashTimeline({
      anchors: [],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_anchor');
  });

  it('never fabricates a $0 balance — empty anchors always refuses', () => {
    const result = buildCashTimeline({
      anchors: [],
      transactions: [tx({ date: '2026-07-05', amount: 1000, type: 'income' })],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(false);
  });
});

// ── 2. Basic balance calculation ──────────────────────────────────────────────

describe('buildCashTimeline — basic balance', () => {
  it('applies income, expense, and transfer with correct signs', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-05', amount: 500,  type: 'income'   }),
        tx({ date: '2026-07-10', amount: 200,  type: 'expense'  }),
        tx({ date: '2026-07-15', amount: 100,  type: 'transfer' }),
      ],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.days.find(d => d.date === '2026-07-05')!.endOfDayBalance).toBe(1500);
    expect(result.days.find(d => d.date === '2026-07-10')!.endOfDayBalance).toBe(1300);
    expect(result.days.find(d => d.date === '2026-07-15')!.endOfDayBalance).toBe(1200);
    expect(result.openingBalance).toBe(1000);
    expect(result.closingBalance).toBe(1200);
  });

  it('openingBalance is the anchor value before that day\'s transactions', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 500)],
      transactions: [tx({ date: '2026-07-01', amount: 1000, type: 'income' })],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-01',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.openingBalance).toBe(500);   // anchor value, before the income
    expect(result.closingBalance).toBe(1500);  // 500 + 1000
  });

  it('todayBalance reflects the end-of-day balance on the current date', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-05', amount: 500, type: 'income'  }),
        tx({ date: '2026-07-05', amount: 200, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-05',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.todayBalance).toBe(1300); // 1000 + 500 - 200
  });

  it('todayBalance is null when today is before balancesStartDate', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-15', 1000)],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-10',  // before the anchor
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.todayBalance).toBeNull();
  });
});

// ── 3. Multiple entries on one day ────────────────────────────────────────────

describe('buildCashTimeline — multiple entries per day', () => {
  it('lists income entries before expenses within the same day', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-15', 1000)],
      transactions: [
        tx({ date: '2026-07-15', amount: 300,  type: 'expense' }),
        tx({ date: '2026-07-15', amount: 2000, type: 'income'  }),
        tx({ date: '2026-07-15', amount: 50,   type: 'expense' }),
      ],
      windowStart: '2026-07-15',
      windowEnd:   '2026-07-15',
      today: '2026-07-14',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const day = result.days[0];
    expect(day.entries[0].type).toBe('income');
    expect(day.entries[1].type).toBe('expense');
    expect(day.entries[2].type).toBe('expense');
  });

  it('end-of-day balance accounts for all entries regardless of display order', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 100)],
      transactions: [
        tx({ date: '2026-07-01', amount: 500,  type: 'expense' }),
        tx({ date: '2026-07-01', amount: 1000, type: 'income'  }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-01',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].endOfDayBalance).toBe(600); // 100 + 1000 - 500
  });
});

// ── 4. Negative day and recovery ──────────────────────────────────────────────

describe('buildCashTimeline — negative balance', () => {
  it('flags a day whose end-of-day balance is negative', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 100)],
      transactions: [
        tx({ date: '2026-07-05', amount: 300, type: 'expense' }),
        tx({ date: '2026-07-06', amount: 500, type: 'income'  }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const neg = result.days.find(d => d.date === '2026-07-05')!;
    const rec = result.days.find(d => d.date === '2026-07-06')!;
    expect(neg.endOfDayBalance).toBe(-200);
    expect(neg.isNegative).toBe(true);
    expect(rec.endOfDayBalance).toBe(300);
    expect(rec.isNegative).toBe(false);
  });
});

// ── 5. Three-paycheque month ──────────────────────────────────────────────────

describe('buildCashTimeline — three-paycheque month', () => {
  it('counts all three bi-weekly paycheques landing in the same month', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 0)],
      transactions: [
        tx({ date: '2026-07-03', amount: 3000, type: 'income'  }),
        tx({ date: '2026-07-10', amount: 1500, type: 'expense' }),
        tx({ date: '2026-07-17', amount: 3000, type: 'income'  }),
        tx({ date: '2026-07-24', amount: 1500, type: 'expense' }),
        tx({ date: '2026-07-31', amount: 3000, type: 'income'  }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 0 + 3000 − 1500 + 3000 − 1500 + 3000 = 6000
    expect(result.closingBalance).toBe(6000);
    expect(result.days.find(d => d.date === '2026-07-31')!.endOfDayBalance).toBe(6000);
  });
});

// ── 6. Month and year boundaries ─────────────────────────────────────────────

describe('buildCashTimeline — month and year boundary', () => {
  it('carries balance correctly from December 31 into January 1', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-12-01', 3000)],
      transactions: [
        tx({ date: '2026-12-31', amount: 200,  type: 'expense' }),
        tx({ date: '2027-01-01', amount: 4000, type: 'income'  }),
      ],
      windowStart: '2026-12-01',
      windowEnd:   '2027-01-31',
      today: '2026-12-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find(d => d.date === '2026-12-31')!.endOfDayBalance).toBe(2800);
    expect(result.days.find(d => d.date === '2027-01-01')!.endOfDayBalance).toBe(6800);
  });
});

// ── 7. First anchor mid-window ────────────────────────────────────────────────

describe('buildCashTimeline — first anchor mid-window', () => {
  it('renders from anchor date when anchor falls after windowStart', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-15', 2000)],
      transactions: [
        tx({ date: '2026-07-20', amount: 500, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-15',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balancesStartDate).toBe('2026-07-15');
    expect(result.openingBalance).toBe(2000);
    // Days before the anchor are not in the output
    expect(result.days.some(d => d.date < '2026-07-15')).toBe(false);
    expect(result.days.find(d => d.date === '2026-07-20')!.endOfDayBalance).toBe(1500);
  });

  it('does not refuse — returns ok: true with a mid-window anchor', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-20', 500)],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
  });
});

// ── 8. Anchor predates window — pre-window walk derives opening balance ───────

describe('buildCashTimeline — anchor before window', () => {
  it('derives opening balance by walking pre-window transactions from the anchor', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-06-15', 2000)],
      transactions: [
        tx({ date: '2026-06-20', amount: 300, type: 'expense' }), // pre-window
        tx({ date: '2026-07-10', amount: 500, type: 'expense' }), // in-window
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balancesStartDate).toBe('2026-07-01');
    expect(result.openingBalance).toBe(1700);  // 2000 − 300
    expect(result.days.find(d => d.date === '2026-07-10')!.endOfDayBalance).toBe(1200);
  });

  it('installment series: pre-window installments contribute to the opening balance', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-05-01', 5000)],
      transactions: [
        tx({ date: '2026-05-15', amount: 200, type: 'expense', recurrenceId: 'inst-1', installmentLabel: '1/6' }),
        tx({ date: '2026-06-15', amount: 200, type: 'expense', recurrenceId: 'inst-1', installmentLabel: '2/6' }),
        tx({ date: '2026-07-15', amount: 200, type: 'expense', recurrenceId: 'inst-1', installmentLabel: '3/6' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.openingBalance).toBe(4600); // 5000 − 200 − 200
    const day15 = result.days.find(d => d.date === '2026-07-15')!;
    expect(day15.endOfDayBalance).toBe(4400); // 4600 − 200
    expect(day15.entries[0].installmentLabel).toBe('3/6');
  });
});

// ── 9. Multi-anchor: corrective anchor mid-window ─────────────────────────────

describe('buildCashTimeline — corrective anchor mid-window', () => {
  it('supersedes derived balance from the corrective anchor date forward', () => {
    const result = buildCashTimeline({
      anchors: [
        anchor('2026-07-01', 1000),
        anchor('2026-07-15', 750), // derived would be 800; anchor corrects to 750
      ],
      transactions: [
        tx({ date: '2026-07-10', amount: 200, type: 'expense' }),
        tx({ date: '2026-07-20', amount: 100, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find(d => d.date === '2026-07-10')!.endOfDayBalance).toBe(800);  // derived from anchor 1
    expect(result.days.find(d => d.date === '2026-07-15')!.endOfDayBalance).toBe(750);  // reset by anchor 2
    expect(result.days.find(d => d.date === '2026-07-20')!.endOfDayBalance).toBe(650);  // 750 − 100
  });

  it('drift-correction: anchor intentionally disagrees with derived balance', () => {
    // User's actual bank balance differs from what the transactions suggest.
    // The anchor is the source of truth; the derived value is discarded.
    const result = buildCashTimeline({
      anchors: [
        anchor('2026-07-01', 2000),
        anchor('2026-07-16', 1800), // derived would be 2000 − 300 = 1700; bank says 1800
      ],
      transactions: [
        tx({ date: '2026-07-10', amount: 300, type: 'expense' }),
        tx({ date: '2026-07-20', amount: 400, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The $100 drift is corrected; post-anchor transactions apply to 1800
    expect(result.days.find(d => d.date === '2026-07-16')!.endOfDayBalance).toBe(1800);
    expect(result.days.find(d => d.date === '2026-07-20')!.endOfDayBalance).toBe(1400); // 1800 − 400
  });

  it('anchor on a day with transactions resets before applying those transactions', () => {
    const result = buildCashTimeline({
      anchors: [
        anchor('2026-07-01', 1000),
        anchor('2026-07-15', 900), // corrective anchor; also has a transaction that day
      ],
      transactions: [
        tx({ date: '2026-07-15', amount: 150, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 900 (anchor resets at start of day) − 150 (expense) = 750
    expect(result.days.find(d => d.date === '2026-07-15')!.endOfDayBalance).toBe(750);
  });
});

// ── 10. Transfer direction ────────────────────────────────────────────────────

describe('buildCashTimeline — transfer direction', () => {
  it('chequing→goal transfer reduces the running balance', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-15', amount: 200, type: 'transfer', transferPeerId: 'goal-row-id' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find(d => d.date === '2026-07-15')!.endOfDayBalance).toBe(800);
  });

  // NOTE: goal→chequing transfers are not supported by any current mechanism.
  // The create_transfer RPC and POST /api/transfers are strictly one-directional
  // (chequing→goal). If reversal is ever added, signAmount must derive direction
  // from transfer_peer_id + account lookup, and a test must be added here.
});

// ── 11. Future entries ────────────────────────────────────────────────────────

describe('buildCashTimeline — future entries', () => {
  it('marks entries after today as isFuture=true', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-03', amount: 200,  type: 'expense' }),
        tx({ date: '2026-07-20', amount: 3000, type: 'income', recurringItemId: 'salary-rule' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-10',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find(d => d.date === '2026-07-03')!.entries[0].isFuture).toBe(false);
    expect(result.days.find(d => d.date === '2026-07-20')!.entries[0].isFuture).toBe(true);
  });

  it('future-dated one-off and recurring entry on the same day are both included', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 2000)],
      transactions: [
        // Materialized recurring income (salary)
        tx({ date: '2026-07-17', amount: 3000, type: 'income', recurringItemId: 'salary-rule' }),
        // One-off planned expense (ordinary future-dated transaction)
        tx({ date: '2026-07-17', amount: 500,  type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-10',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const day = result.days.find(d => d.date === '2026-07-17')!;
    expect(day.entries).toHaveLength(2);
    expect(day.entries[0].type).toBe('income');   // income listed first
    expect(day.entries[1].type).toBe('expense');
    expect(day.endOfDayBalance).toBe(4500);        // 2000 + 3000 − 500
    expect(day.entries.every(e => e.isFuture)).toBe(true);
  });
});

// ── 12. Dip detection ─────────────────────────────────────────────────────────

describe('buildCashTimeline — dip detection', () => {
  it('identifies the minimum balance day between today and the next income entry', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-05', amount: 400, type: 'expense' }), // 600
        tx({ date: '2026-07-10', amount: 300, type: 'expense' }), // 300
        tx({ date: '2026-07-12', amount: 100, type: 'expense' }), // 200 ← dip
        tx({ date: '2026-07-15', amount: 3000, type: 'income' }), // next income
        tx({ date: '2026-07-20', amount: 500,  type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextIncomeDate).toBe('2026-07-15');
    expect(result.dip).not.toBeNull();
    expect(result.dip!.date).toBe('2026-07-12');
    expect(result.dip!.balance).toBe(200);
  });

  it('returns null dip when no income entry exists after today in the window', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-10', amount: 200, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dip).toBeNull();
    expect(result.nextIncomeDate).toBeNull();
  });

  it('dip is null when today is after windowEnd (past month view)', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-06-01', 1000)],
      transactions: [
        tx({ date: '2026-06-10', amount: 500,  type: 'expense' }),
        tx({ date: '2026-06-15', amount: 3000, type: 'income'  }),
      ],
      windowStart: '2026-06-01',
      windowEnd:   '2026-06-30',
      today: '2026-07-03',  // today is outside the window
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dip).toBeNull();
  });

  it('dip includes the day of the income entry itself (end-of-day balance after all entries)', () => {
    // Income day also has an expense; the end-of-day balance may still be the minimum
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 500)],
      transactions: [
        tx({ date: '2026-07-10', amount: 3000, type: 'income'  }), // next income
        tx({ date: '2026-07-10', amount: 3100, type: 'expense' }), // large expense same day
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // End of July 3 = 500 (no txns between anchor and next income aside from July 10)
    // End of July 10 = 500 + 3000 - 3100 = 400 ← dip
    expect(result.dip!.balance).toBe(400);
    expect(result.dip!.date).toBe('2026-07-10');
  });
});

// ── 13. closingBalance — no silent $0 ────────────────────────────────────────

describe('buildCashTimeline — closingBalance with zero transactions', () => {
  it('(a) anchor on last day of window, zero transactions → opening/closing/today all equal anchor', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-31', 1234.56)],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-31',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.openingBalance).toBe(1234.56);
    expect(result.closingBalance).toBe(1234.56);
    expect(result.todayBalance).toBe(1234.56);
  });

  it('(b) anchor mid-window, zero transactions in window → opening/closing equal anchor', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-15', 800)],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-20',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.openingBalance).toBe(800);
    expect(result.closingBalance).toBe(800);
    expect(result.todayBalance).toBe(800);
    // All days from July 15 to July 31 are present with the anchor balance
    expect(result.days.every(d => d.endOfDayBalance === 800)).toBe(true);
    expect(result.days[0].date).toBe('2026-07-15');
  });
});

// ── 14. Rounding ─────────────────────────────────────────────────────────────

describe('buildCashTimeline — rounding', () => {
  it('rounds after each accumulation step to prevent floating-point drift', () => {
    // 0 + 33.33 + 33.33 + 33.33 must equal 99.99, not 99.99000000000001
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 0)],
      transactions: [
        tx({ date: '2026-07-01', amount: 33.33, type: 'income' }),
        tx({ date: '2026-07-02', amount: 33.33, type: 'income' }),
        tx({ date: '2026-07-03', amount: 33.33, type: 'income' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.find(d => d.date === '2026-07-03')!.endOfDayBalance).toBe(99.99);
  });
});

// ── 15. selectAnchorsForTimeline ──────────────────────────────────────────────

describe('selectAnchorsForTimeline', () => {
  const pool: TimelineAnchor[] = [
    { date: '2026-04-01', balance: 500  },
    { date: '2026-05-01', balance: 1500 },
    { date: '2026-06-01', balance: 2000 },
    { date: '2026-07-10', balance: 1200 }, // inside window
    { date: '2026-08-01', balance: 3000 }, // after windowEnd
  ];
  const WIN_START = '2026-07-01';
  const WIN_END   = '2026-07-31';

  it('returns the latest pre-window anchor + all in-window anchors, sorted ascending', () => {
    const result = selectAnchorsForTimeline(pool, WIN_START, WIN_END);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-06-01');
    expect(result[1].date).toBe('2026-07-10');
  });

  it('selects only the latest pre-window anchor (not all of them)', () => {
    const result = selectAnchorsForTimeline(pool, WIN_START, WIN_END);
    expect(result[0].date).toBe('2026-06-01'); // not April or May
    expect(result[0].balance).toBe(2000);
  });

  it('anchor exactly on windowStart is treated as pre-window', () => {
    const result = selectAnchorsForTimeline(
      [{ date: '2026-07-01', balance: 999 }],
      '2026-07-01', '2026-07-31'
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-07-01');
  });

  it('excludes anchors after windowEnd', () => {
    const result = selectAnchorsForTimeline(
      [{ date: '2026-07-01', balance: 1000 }, { date: '2026-08-01', balance: 2000 }],
      '2026-07-01', '2026-07-31'
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-07-01');
  });

  it('returns [] when no anchors exist', () => {
    expect(selectAnchorsForTimeline([], WIN_START, WIN_END)).toEqual([]);
  });

  it('returns [] when all anchors are after windowEnd', () => {
    const result = selectAnchorsForTimeline(
      [{ date: '2026-08-01', balance: 1000 }],
      '2026-07-01', '2026-07-31'
    );
    expect(result).toEqual([]);
  });

  it('returns only in-window anchor when no pre-window anchor exists (mid-window case)', () => {
    const result = selectAnchorsForTimeline(
      [{ date: '2026-07-15', balance: 750 }],
      '2026-07-01', '2026-07-31'
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-07-15');
  });
});

// ── 16. Pipeline integration — selectAnchorsForTimeline → buildCashTimeline ──

describe('selectAnchorsForTimeline + buildCashTimeline pipeline', () => {
  it('no-anchor state end-to-end: empty selection → no_anchor refusal', () => {
    const selected = selectAnchorsForTimeline([], '2026-07-01', '2026-07-31');
    const result = buildCashTimeline({
      anchors: selected,
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_anchor');
  });

  it('mid-window first-anchor end-to-end: renders from anchor, not refused', () => {
    const selected = selectAnchorsForTimeline(
      [{ date: '2026-07-15', balance: 2500 }],
      '2026-07-01', '2026-07-31'
    );
    const result = buildCashTimeline({
      anchors: selected,
      transactions: [
        tx({ date: '2026-07-20', amount: 300, type: 'expense' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-15',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balancesStartDate).toBe('2026-07-15');
    expect(result.openingBalance).toBe(2500);
    expect(result.closingBalance).toBe(2200); // 2500 - 300
    expect(result.days.some(d => d.date < '2026-07-15')).toBe(false);
  });

  it('pre-window anchor: transaction fetch from anchor date derives correct opening balance', () => {
    // Simulates the API fetching from anchor date (June 1) not just windowStart (July 1)
    const selected = selectAnchorsForTimeline(
      [{ date: '2026-06-01', balance: 3000 }],
      '2026-07-01', '2026-07-31'
    );
    const result = buildCashTimeline({
      anchors: selected,
      transactions: [
        // Pre-window transactions fetched because selected[0].date = June 1
        tx({ date: '2026-06-15', amount: 1000, type: 'expense' }),
        tx({ date: '2026-06-30', amount: 200,  type: 'expense' }),
        // In-window
        tx({ date: '2026-07-10', amount: 5000, type: 'income' }),
      ],
      windowStart: '2026-07-01',
      windowEnd:   '2026-07-31',
      today: '2026-07-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.openingBalance).toBe(1800); // 3000 - 1000 - 200
    expect(result.days.find(d => d.date === '2026-07-10')!.endOfDayBalance).toBe(6800);
  });
});
