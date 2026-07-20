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
 * REFUND NETTING
 * ---------------
 * The bridge amount for a cycle is that card's expenses MINUS its money-in
 * (refund) entries within the same window — the exact same netting rule
 * envelopeHelpers.ts's category actuals use (signedAmount: expense adds,
 * income subtracts). Never show a negative payment: if refunds exceed
 * spend in a cycle, the bridge for that payment date is zero (existing row
 * deleted, no row inserted) — a resulting credit balance carrying forward
 * to the next cycle is explicitly out of scope.
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
 *
 * FAIL-CLOSED (2026-07-22, Codex adversarial review Tier 2)
 * -----------------------------------------------------------
 * Every read and write below throws on error instead of discarding it.
 * Before this fix, a failed read silently produced an empty result (`data`
 * undefined, `error` dropped), which computeBridgeSync would then read as
 * "this card has zero spend this cycle" — deleting a perfectly valid
 * existing bridge row over a transient read error, not a real zero. A
 * failed write returned success just as silently, so a caller (Timeline,
 * the dashboard) would proceed to read transactions believing the bridge
 * was synced when nothing had actually been written. Both are now thrown
 * errors that callers must let propagate (a 500, not a silently understated
 * or wrongly-deleted figure) — silent failure is worse than visible failure.
 *
 * NOT a single DB transaction: ensureBridgesForWindow still makes several
 * round trips (2 reads, up to 3 writes), so a failure partway through the
 * writes can still leave a partially-synced set of bridge rows for this
 * call. What changed is that such a failure now always throws — it can
 * never present as success. A fully atomic version would need to become a
 * plpgsql RPC (the same pattern create_transfer uses) so all inserts/
 * updates/deletes commit or roll back together; that's a larger rewrite
 * left for later if partial-write states are ever actually observed live.
 */

import { bridgePaymentDate, statementCycleWindow } from './dateHelpers';
import { signedAmount } from './envelopeHelpers';

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
 * Pure. Nets a card's expense-minus-refund total within a statement-cycle
 * window — the same signedAmount rule envelopeHelpers.ts's category actuals
 * use. Transactions outside [window.start, window.end] are ignored. Can
 * return a negative number (refunds exceeded spend in this cycle) — the
 * caller (computeBridgeSync) is responsible for treating that as "no
 * payment," never a negative one.
 */
export function netCycleSpend(
  txns: { date: string; type: string; amount: number }[],
  window: { start: string; end: string }
): number {
  let sum = 0;
  for (const t of txns) {
    if (t.date < window.start || t.date > window.end) continue;
    const signed = signedAmount(t);
    if (signed !== null) sum += signed;
  }
  return r2(sum);
}

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

  // One query for every card's expense AND income (refund) rows across the
  // whole span — netting needs both sides of the ledger, not just spend.
  const { data: spendTxns, error: spendErr } = await supabase
    .from('transactions')
    .select('account_id, amount, date, type')
    .eq('household_id', householdId)
    .in('account_id', cardIds)
    .in('type', ['expense', 'income'])
    .gte('date', minStart as string)
    .lte('date', maxEnd as string);

  if (spendErr) {
    throw new Error(`ensureBridgesForWindow: failed to read card transactions — ${spendErr.message ?? spendErr}`);
  }

  const txnsByCard = new Map<string, { amount: number; date: string; type: string }[]>();
  for (const t of (spendTxns ?? []) as { account_id: string | null; amount: number; date: string; type: string }[]) {
    if (!t.account_id) continue;
    const list = txnsByCard.get(t.account_id) ?? [];
    list.push({ amount: Number(t.amount), date: t.date, type: t.type });
    txnsByCard.set(t.account_id, list);
  }

  // One query for every existing bridge row across all cycle months.
  const { data: existingRows, error: existingErr } = await supabase
    .from('transactions')
    .select('id, bridge_source_account, bridge_source_month, amount')
    .eq('household_id', householdId)
    .eq('is_bridge', true)
    .in('bridge_source_month', spendMonths)
    .in('bridge_source_account', cardIds);

  if (existingErr) {
    throw new Error(`ensureBridgesForWindow: failed to read existing bridge rows — ${existingErr.message ?? existingErr}`);
  }

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
      cardTotals.set(card.id, netCycleSpend(txns, w));
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
    const { error } = await supabase.from('transactions').insert(allInserts);
    if (error) throw new Error(`ensureBridgesForWindow: failed to insert bridge rows — ${error.message ?? error}`);
  }
  if (allUpdates.length > 0) {
    const results = await Promise.all(
      allUpdates.map((u) => supabase.from('transactions').update({ amount: u.amount }).eq('id', u.id))
    );
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(`ensureBridgesForWindow: failed to update a bridge row — ${failed.error.message ?? failed.error}`);
  }
  if (allDeletes.length > 0) {
    const { error } = await supabase.from('transactions').delete().in('id', allDeletes);
    if (error) throw new Error(`ensureBridgesForWindow: failed to delete stale bridge rows — ${error.message ?? error}`);
  }
}
