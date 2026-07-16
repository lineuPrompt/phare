import { describe, it, expect } from 'vitest';
import { ensureBridgesForWindow, type BridgeCardInfo } from '../bridgeHelpers';
import { reconcileMonth, type ReconcileTxRow, type ReconcileAccountRow } from '../reconcileHelpers';

/**
 * Integration invariant for Phase 1.2: after ANY scripted sequence of card-
 * entry add/edit/delete followed by ensureBridgesForWindow, reconciliation's
 * two independent derivation paths (bucket totals vs. direct chequing ledger)
 * must still agree — delta = 0. This is the automated version of the
 * founder's live −$42.20 mismatch screenshot: a bridge row that goes stale
 * (wrong amount, or left behind after its card entries are gone) is exactly
 * the kind of malformed ledger row that would flip `reconciled` to false.
 *
 * A minimal in-memory fake stands in for the Supabase client — only the
 * `transactions` table operations ensureBridgesForWindow actually issues
 * (select/insert/update/delete) are implemented, backed by one mutable array
 * so inserts/updates/deletes from one `ensure` call are visible to the next.
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(seed: Row[]) {
  let rows: Row[] = seed.map((r) => ({ ...r }));
  let idCounter = 1;

  function selectQuery(initial: Row[]) {
    let result = initial;
    const api = {
      eq(field: string, value: unknown) { result = result.filter((r) => r[field] === value); return api; },
      in(field: string, values: unknown[]) { result = result.filter((r) => values.includes(r[field])); return api; },
      gte(field: string, value: string) { result = result.filter((r) => (r[field] as string) >= value); return api; },
      lte(field: string, value: string) { result = result.filter((r) => (r[field] as string) <= value); return api; },
      then(resolve: (v: { data: Row[] }) => unknown) {
        return Promise.resolve({ data: result.map((r) => ({ ...r })) }).then(resolve);
      },
    };
    return api;
  }

  const supabase = {
    from(table: string) {
      if (table !== 'transactions') throw new Error(`fake supabase: unexpected table "${table}"`);
      return {
        select() { return selectQuery(rows); },
        insert(newRows: Record<string, unknown>[]) {
          const withIds: Row[] = newRows.map((r) => ({ ...r, id: `bridge-${idCounter++}` }));
          rows = [...rows, ...withIds];
          return Promise.resolve({ data: withIds });
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(field: string, value: unknown) {
              rows = rows.map((r) => (r[field] === value ? { ...r, ...patch } : r));
              return Promise.resolve({ data: null });
            },
          };
        },
        delete() {
          return {
            in(field: string, values: unknown[]) {
              rows = rows.filter((r) => !values.includes(r[field]));
              return Promise.resolve({ data: null });
            },
          };
        },
      };
    },
    currentRows(): Row[] {
      return rows;
    },
    addRow(row: Row) {
      rows = [...rows, row];
    },
    editRow(id: string, patch: Record<string, unknown>) {
      rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    },
    deleteRow(id: string) {
      rows = rows.filter((r) => r.id !== id);
    },
  };

  return supabase;
}

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq';
const CARD = 'acc-visa';
const MEMBER = 'mem-1';

const cards: BridgeCardInfo[] = [
  { id: CARD, name: 'Visa', payment_day: 5, statement_close_day: 15 },
];

// Cycle month 2026-07 → window 2026-06-16..2026-07-15, payment date 2026-08-05.
const CYCLE_MONTH = '2026-07';

function accountsFixture(): ReconcileAccountRow[] {
  return [
    { id: CHEQUING, type: 'chequing', name: 'Chequing' },
    { id: CARD, type: 'credit_card', name: 'Visa' },
  ];
}

function reconcileAll(supabase: ReturnType<typeof makeFakeSupabase>) {
  const txns = supabase.currentRows().map((r) => ({
    id: r.id as string,
    date: r.date as string,
    description: (r.description ?? null) as string | null,
    amount: Number(r.amount),
    type: r.type as string,
    account_id: (r.account_id ?? null) as string | null,
    is_bridge: Boolean(r.is_bridge),
  })) as ReconcileTxRow[];
  return reconcileMonth(txns, accountsFixture());
}

async function ensure(supabase: ReturnType<typeof makeFakeSupabase>) {
  await ensureBridgesForWindow({
    supabase,
    householdId: HOUSEHOLD,
    chequingId: CHEQUING,
    memberId: MEMBER,
    cards,
    spendMonths: [CYCLE_MONTH],
  });
}

function bridgeRow(supabase: ReturnType<typeof makeFakeSupabase>) {
  return supabase.currentRows().find((r) => r.is_bridge === true && r.bridge_source_month === CYCLE_MONTH);
}

describe('Phase 1.2 invariant — reconciliation stays balanced through card-entry mutation + ensure', () => {
  it('add → ensure: bridge inserted, reconciled, amount matches card total', async () => {
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 100, type: 'expense', date: '2026-07-01', description: 'Groceries', is_bridge: false },
    ]);

    await ensure(supabase);

    const bridge = bridgeRow(supabase);
    expect(bridge).toBeTruthy();
    expect(bridge!.amount).toBe(100);
    expect(bridge!.date).toBe('2026-08-05');

    const result = reconcileAll(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('edit → ensure: bridge amount updates in place (not left stale), still reconciled', async () => {
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 100, type: 'expense', date: '2026-07-01', description: 'Groceries', is_bridge: false },
    ]);
    await ensure(supabase);
    const firstBridgeId = bridgeRow(supabase)!.id as string;

    // Founder edits the card entry's amount after the bridge already exists.
    supabase.editRow('card-1', { amount: 250 });
    await ensure(supabase);

    const bridge = bridgeRow(supabase);
    expect(bridge!.id).toBe(firstBridgeId); // same row, updated — not duplicated
    expect(bridge!.amount).toBe(250);

    const result = reconcileAll(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('delete all card entries → ensure: stale bridge row is removed, still reconciled', async () => {
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 100, type: 'expense', date: '2026-07-01', description: 'Groceries', is_bridge: false },
    ]);
    await ensure(supabase);
    expect(bridgeRow(supabase)).toBeTruthy();

    // Founder deletes the (test) card entry entirely — this was the live bug:
    // the bridge used to survive with the old, now-wrong amount.
    supabase.deleteRow('card-1');
    await ensure(supabase);

    expect(bridgeRow(supabase)).toBeUndefined();

    const result = reconcileAll(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('add another entry after deletion → ensure: bridge reappears with the new total, reconciled', async () => {
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 100, type: 'expense', date: '2026-07-01', description: 'Groceries', is_bridge: false },
    ]);
    await ensure(supabase);
    supabase.deleteRow('card-1');
    await ensure(supabase);
    expect(bridgeRow(supabase)).toBeUndefined();

    supabase.addRow({ id: 'card-2', household_id: HOUSEHOLD, account_id: CARD, amount: 42.2, type: 'expense', date: '2026-07-10', description: 'Gas', is_bridge: false });
    await ensure(supabase);

    const bridge = bridgeRow(supabase);
    expect(bridge!.amount).toBe(42.2);

    const result = reconcileAll(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('real-world shape (item B, 2026-07-16): a card refund alongside card spend stays reconciled through ensure', async () => {
    // The persisting reconciliation mismatch after the statement-cycle fix
    // was NOT a bridge bug at all — computeMonthTotals (dashboardHelpers.ts)
    // counted a card refund (type='income' on the credit_card account) as
    // household income unconditionally, while chequingLedgerNet correctly
    // excluded it (not a chequing row). This test encodes exactly that
    // real-world shape end-to-end: card spend + a card refund + the bridge
    // sync, then reconciliation must hold.
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 100, type: 'expense', date: '2026-07-01', description: 'Groceries', is_bridge: false },
      { id: 'card-2', household_id: HOUSEHOLD, account_id: CARD, amount: 20, type: 'income', date: '2026-07-05', description: 'Refund', is_bridge: false },
    ]);

    await ensure(supabase);

    const result = reconcileAll(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
    // The refund is not household income — it never entered chequing.
    expect(result.totalIncome).toBe(0);
  });

  it('a full add/edit/delete/re-add sequence stays reconciled at every single step', async () => {
    const supabase = makeFakeSupabase([]);

    await ensure(supabase);
    expect(reconcileAll(supabase).reconciled).toBe(true);

    supabase.addRow({ id: 'e1', household_id: HOUSEHOLD, account_id: CARD, amount: 60, type: 'expense', date: '2026-06-20', description: 'A', is_bridge: false });
    await ensure(supabase);
    expect(reconcileAll(supabase).reconciled).toBe(true);
    expect(bridgeRow(supabase)!.amount).toBe(60);

    supabase.addRow({ id: 'e2', household_id: HOUSEHOLD, account_id: CARD, amount: 40, type: 'expense', date: '2026-07-01', description: 'B', is_bridge: false });
    await ensure(supabase);
    expect(reconcileAll(supabase).reconciled).toBe(true);
    expect(bridgeRow(supabase)!.amount).toBe(100);

    supabase.editRow('e1', { amount: 10 });
    await ensure(supabase);
    expect(reconcileAll(supabase).reconciled).toBe(true);
    expect(bridgeRow(supabase)!.amount).toBe(50);

    supabase.deleteRow('e1');
    supabase.deleteRow('e2');
    await ensure(supabase);
    expect(reconcileAll(supabase).reconciled).toBe(true);
    expect(bridgeRow(supabase)).toBeUndefined();
  });
});
