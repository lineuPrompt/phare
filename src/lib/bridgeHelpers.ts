/**
 * bridgeHelpers.ts — Card-to-chequing payment bridge logic.
 *
 * Extracted from GET /api/expenses so there is one bridge-creation code path
 * shared by both the expenses page and the timeline endpoint.
 *
 * CYCLE WINDOWING
 * ----------------
 * A card's spend for a given payment date is the sum of its transactions in
 * the STATEMENT CYCLE that produced that statement — from the day after the
 * previous close date through this cycle's close date (statementCycleWindow
 * in dateHelpers.ts) — not a plain calendar month. Cards without a
 * statement_close_day set fall back to the calendar month.
 *
 * LIVING ROWS — NOT INSERT-ONCE
 * ------------------------------
 * ensureBridgesForWindow recomputes each card's cycle total from current
 * transactions on every call and syncs the bridge row to match:
 *   - no row yet + spend > 0            → insert
 *   - row exists + amount changed        → update in place
 *   - row exists + spend is now 0        → delete (card entries were edited
 *                                           or removed down to nothing)
 * This deliberately replaces the old insert-once/immutable-once-created
 * behavior: a bridge row must always reflect the card's current entries, so
 * a deleted or edited card entry is never left behind as a stale timeline
 * row (this was the root cause of stale bridges surviving deleted test
 * entries, and of reconciliation mismatches between the two derivation
 * paths). A user can no longer hand-edit a bridge amount to permanently
 * override it — any manual edit is overwritten on the next ensure call.
 *
 * IDEMPOTENCY
 * -----------
 * The DB unique index on (household_id, bridge_source_account,
 * bridge_source_month) WHERE is_bridge still guards against duplicate
 * inserts if this ever races.
 */

import { bridgePaymentDate, statementCycleWindow } from './dateHelpers';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BridgeCardInfo = {
  id: string;
  name: string;
  payment_day: number | null;
  statement_close_day: number | null;
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

export type ExistingBridgeRow = {
  id: string;
  bridge_source_account: string;
  amount: number;
};

export type BridgeSyncResult = {
  toInsert: BridgeInsertRow[];
  toUpdate: { id: string; amount: number }[];
  toDelete: string[];
};

// Duck type for the Supabase client — avoids importing next/headers in test files.
type SupabaseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Pure function ─────────────────────────────────────────────────────────────

/**
 * Pure. Given each card's freshly-recomputed cycle total and the bridge row
 * that (may) already exist for this cycle, decides what to insert, update,
 * or delete so the bridge rows always match current card entries.
 */
export function computeBridgeSync(params: {
  cards: BridgeCardInfo[];
  cardTotals: Map<string, number>;
  existingBridges: ExistingBridgeRow[];
  spendMonth: string;
  chequingId: string;
  householdId: string;
  memberId: string | null;
}): BridgeSyncResult {
  const { cards, cardTotals, existingBridges, spendMonth, chequingId, householdId, memberId } = params;

  const existingByCard = new Map(existingBridges.map((b) => [b.bridge_source_account, b]));

  const toInsert: BridgeInsertRow[] = [];
  const toUpdate: { id: string; amount: number }[] = [];
  const toDelete: string[] = [];

  for (const card of cards) {
    const rawTotal = cardTotals.get(card.id) ?? 0;
    const total = rawTotal > 0 ? r2(rawTotal) : 0;
    const existing = existingByCard.get(card.id);

    if (total <= 0) {
      if (existing) toDelete.push(existing.id);
      continue;
    }

    if (existing) {
      if (existing.amount !== total) {
        toUpdate.push({ id: existing.id, amount: total });
      }
      continue;
    }

    toInsert.push({
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

  return { toInsert, toUpdate, toDelete };
}

// ── Async helper ──────────────────────────────────────────────────────────────

/**
 * For each cycle month, syncs the bridge payment row in chequing to match
 * each card's current statement-cycle spend. Living rows: insert, update, or
 * delete as needed — see module docstring.
 *
 * spendMonths — YYYY-MM strings, each the month containing a statement close
 *               date (the "cycle month"). The payment date is cycle month + 1
 *               at the card's payment_day. Pass all cycle months whose
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

  // Per-card, per-cycle-month window, plus the overall min/max date span so
  // all transactions can be fetched in a single query.
  const windowsByCard = new Map<string, Map<string, { start: string; end: string }>>();
  let minStart: string | null = null;
  let maxEnd: string | null = null;

  for (const card of cards) {
    const perMonth = new Map<string, { start: string; end: string }>();
    for (const cycleMonth of spendMonths) {
      const w = statementCycleWindow(cycleMonth, card.statement_close_day ?? null);
      perMonth.set(cycleMonth, w);
      if (minStart === null || w.start < minStart) minStart = w.start;
      if (maxEnd === null || w.end > maxEnd) maxEnd = w.end;
    }
    windowsByCard.set(card.id, perMonth);
  }

  // One query for every card's spend across the whole span.
  const { data: spendTxns } = await supabase
    .from('transactions')
    .select('account_id, amount, date')
    .eq('household_id', householdId)
    .in('account_id', cardIds)
    .eq('type', 'expense')
    .gte('date', minStart as string)
    .lte('date', maxEnd as string);

  const txnsByCard = new Map<string, { amount: number; date: string }[]>();
  for (const t of (spendTxns ?? []) as { account_id: string | null; amount: number; date: string }[]) {
    if (!t.account_id) continue;
    const list = txnsByCard.get(t.account_id) ?? [];
    list.push({ amount: Number(t.amount), date: t.date });
    txnsByCard.set(t.account_id, list);
  }

  // One query for every existing bridge row across all cycle months.
  const { data: existingRows } = await supabase
    .from('transactions')
    .select('id, bridge_source_account, bridge_source_month, amount')
    .eq('household_id', householdId)
    .eq('is_bridge', true)
    .in('bridge_source_month', spendMonths)
    .in('bridge_source_account', cardIds);

  const existingByMonth = new Map<string, ExistingBridgeRow[]>();
  for (const r of (existingRows ?? []) as { id: string; bridge_source_account: string | null; bridge_source_month: string; amount: number }[]) {
    if (!r.bridge_source_account) continue;
    const list = existingByMonth.get(r.bridge_source_month) ?? [];
    list.push({ id: r.id, bridge_source_account: r.bridge_source_account, amount: Number(r.amount) });
    existingByMonth.set(r.bridge_source_month, list);
  }

  const allInserts: BridgeInsertRow[] = [];
  const allUpdates: { id: string; amount: number }[] = [];
  const allDeletes: string[] = [];

  for (const cycleMonth of spendMonths) {
    const cardTotals = new Map<string, number>();
    for (const card of cards) {
      const w = windowsByCard.get(card.id)!.get(cycleMonth)!;
      const txns = txnsByCard.get(card.id) ?? [];
      let sum = 0;
      for (const t of txns) {
        if (t.date >= w.start && t.date <= w.end) sum += t.amount;
      }
      cardTotals.set(card.id, r2(sum));
    }

    const { toInsert, toUpdate, toDelete } = computeBridgeSync({
      cards, cardTotals,
      existingBridges: existingByMonth.get(cycleMonth) ?? [],
      spendMonth: cycleMonth, chequingId, householdId, memberId,
    });

    allInserts.push(...toInsert);
    allUpdates.push(...toUpdate);
    allDeletes.push(...toDelete);
  }

  if (allInserts.length > 0) {
    await supabase.from('transactions').insert(allInserts);
  }
  if (allUpdates.length > 0) {
    await Promise.all(
      allUpdates.map((u) => supabase.from('transactions').update({ amount: u.amount }).eq('id', u.id))
    );
  }
  if (allDeletes.length > 0) {
    await supabase.from('transactions').delete().in('id', allDeletes);
  }
}
