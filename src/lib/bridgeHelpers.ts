/**
 * bridgeHelpers.ts — Card-to-chequing payment bridge logic.
 *
 * Extracted from GET /api/expenses so there is one bridge-creation code path
 * shared by both the expenses page and the timeline endpoint.
 *
 * IDEMPOTENCY GUARANTEE
 * ---------------------
 * computeBridgeInserts (pure) skips cards that already have a bridge row for
 * the spending month. ensureBridgesForWindow checks existing rows before
 * inserting. The DB unique index on
 * (household_id, bridge_source_account, bridge_source_month) WHERE is_bridge
 * provides a second line of defence against duplicates.
 *
 * IMMUTABILITY GUARANTEE
 * ----------------------
 * If a bridge row already exists (user may have edited the amount to match
 * their real statement), it is left untouched. Only missing rows are created.
 */

import { bridgePaymentDate } from './dateHelpers';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BridgeCardInfo = {
  id: string;
  name: string;
  payment_day: number | null;
};

export type BridgeInsertRow = {
  household_id: string;
  member_id: string | null;
  account_id: string;
  category_id: null;
  amount: number;
  description: string;
  date: string;
  type: 'expense';
  source: 'bridge';
  is_bridge: true;
  bridge_source_account: string;
  bridge_source_month: string;
};

// Duck type for the Supabase client — avoids importing next/headers in test files.
type SupabaseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

// ── Pure function ─────────────────────────────────────────────────────────────

/**
 * Pure. Returns the bridge rows that need to be inserted for a given spending
 * month: one row per card that had spending and does not already have a bridge.
 *
 * Idempotent: cards in existingBridgeAccounts produce no output row.
 */
export function computeBridgeInserts(params: {
  cards: BridgeCardInfo[];
  cardTotals: Map<string, number>;
  existingBridgeAccounts: Set<string>;
  spendMonth: string;
  chequingId: string;
  householdId: string;
  memberId: string | null;
}): BridgeInsertRow[] {
  const { cards, cardTotals, existingBridgeAccounts, spendMonth, chequingId, householdId, memberId } = params;
  const rows: BridgeInsertRow[] = [];

  for (const card of cards) {
    const total = cardTotals.get(card.id) ?? 0;
    if (total <= 0) continue;
    if (existingBridgeAccounts.has(card.id)) continue;

    rows.push({
      household_id: householdId,
      member_id: memberId,
      account_id: chequingId,
      category_id: null,
      amount: total,
      description: `${card.name} payment`,
      date: bridgePaymentDate(spendMonth, card.payment_day ?? 1),
      type: 'expense',
      source: 'bridge',
      is_bridge: true,
      bridge_source_account: card.id,
      bridge_source_month: spendMonth,
    });
  }

  return rows;
}

// ── Async helper ──────────────────────────────────────────────────────────────

/**
 * For each spending month, ensures a bridge payment row exists in chequing for
 * every card that had expenses in that month. Idempotent.
 *
 * spendMonths — YYYY-MM strings. The payment date (spending month + 1) is what
 *               appears in the chequing ledger. Pass all spending months whose
 *               payment date falls within the timeline window.
 */
export async function ensureBridgesForWindow(params: {
  supabase: SupabaseClient;
  householdId: string;
  chequingId: string;
  memberId: string | null;
  cards: BridgeCardInfo[];
  spendMonths: string[];
}): Promise<void> {
  const { supabase, householdId, chequingId, memberId, cards, spendMonths } = params;
  if (cards.length === 0 || spendMonths.length === 0) return;

  const cardIds = cards.map((c) => c.id);

  for (const spendMonth of spendMonths) {
    const spendStart = `${spendMonth}-01`;
    const [sy, sm] = spendMonth.split('-').map(Number);
    const nextMonthStart = sm === 12
      ? `${sy + 1}-01-01`
      : `${sy}-${String(sm + 1).padStart(2, '0')}-01`;

    // Sum each card's spending in this month (one query for all cards)
    const { data: spendTxns } = await supabase
      .from('transactions')
      .select('account_id, amount')
      .eq('household_id', householdId)
      .in('account_id', cardIds)
      .eq('type', 'expense')
      .gte('date', spendStart)
      .lt('date', nextMonthStart);

    const cardTotals = new Map<string, number>();
    for (const t of spendTxns ?? []) {
      if (!t.account_id) continue;
      const prev = cardTotals.get(t.account_id) ?? 0;
      cardTotals.set(t.account_id, Math.round((prev + Number(t.amount)) * 100) / 100);
    }

    // Which cards already have a bridge row for this spending month?
    const { data: existingBridges } = await supabase
      .from('transactions')
      .select('bridge_source_account')
      .eq('household_id', householdId)
      .eq('is_bridge', true)
      .eq('bridge_source_month', spendMonth)
      .in('bridge_source_account', cardIds);

    const existingBridgeAccounts = new Set<string>(
      (existingBridges ?? [])
        .map((r: { bridge_source_account: string | null }) => r.bridge_source_account)
        .filter((id: string | null): id is string => id !== null)
    );

    const rows = computeBridgeInserts({
      cards, cardTotals, existingBridgeAccounts,
      spendMonth, chequingId, householdId, memberId,
    });

    if (rows.length > 0) {
      await supabase.from('transactions').insert(rows);
    }
  }
}
