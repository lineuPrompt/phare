import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMonthView } from '@phare/core';
import { ensureBridgesForWindow } from './bridgeHelpers';
import { addMonthsToMonth } from './goalHelpers';
import { buildCashTimeline, selectAnchorsForTimeline, type TimelineAnchor } from './timelineHelpers';
import { TRANSACTION_COLUMNS, toTimelineTxs } from './timelineLedger';

// ---------------------------------------------------------------------------
// The month after the reviewed one, as the Cash Timeline shows it: its lowest
// end-of-day chequing balance, the date it is reached, and whether any day is
// dated below zero.
//
// THE TIMELINE'S OWN PATH, step for step (GET /api/timeline): ensure the card
// payment that lands in that month is in the ledger, pick the anchors with
// selectAnchorsForTimeline, read the chequing rows with the same column list,
// walk them with buildCashTimeline, slice the month with buildMonthView —
// whose `lowest` is the Timeline month strip's "how low does this month get".
//
// ENSURING THE BRIDGE IS A WRITE, as it is on every Timeline and dashboard
// read: a card cycle whose payment row was never materialised would otherwise
// leave the month looking richer than it is. The row is derived, idempotent,
// and carries no member (memberId null: expenses never get attribution).
//
// null when there is nothing honest to say: no anchored balance, or a month
// outside what the walk produced. The letter then gets no figure at all.
// ---------------------------------------------------------------------------

export type MonthAheadFacts = {
  month: string;
  lowestBalance: number;
  lowestDate: string;
  anyDayBelowZero: boolean;
  /** First day whose end-of-day balance is below zero; present only when there is one. */
  firstDayBelowZero?: string;
};

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export async function loadMonthAhead(params: {
  supabase: SupabaseClient;
  householdId: string;
  chequingId: string;
  cards: { id: string; name: string; payment_day: number | null; statement_close_day: number | null }[];
  month: string;
  today: string;
}): Promise<MonthAheadFacts | null> {
  const { supabase, householdId, chequingId, cards, month, today } = params;
  const windowStart = `${month}-01`;
  const windowEnd = lastDayOf(month);

  const { data: rawAnchors, error: anchorErr } = await supabase
    .from('account_balance_anchors')
    .select('anchor_date, balance')
    .eq('account_id', chequingId)
    .eq('household_id', householdId)
    .lte('anchor_date', windowEnd)
    .order('anchor_date', { ascending: true });
  if (anchorErr) throw new Error(`account_balance_anchors read failed: ${anchorErr.message}`);

  const anchors = selectAnchorsForTimeline(
    (rawAnchors ?? []).map((a): TimelineAnchor => ({ date: a.anchor_date as string, balance: Number(a.balance) })),
    windowStart,
    windowEnd
  );
  if (anchors.length === 0) return null;

  // A card cycle's payment lands in the month after it (bridgeHelpers.ts).
  // After the anchor check: with no anchored balance there is nothing to
  // compute, and nothing is written.
  await ensureBridgesForWindow({
    supabase,
    householdId,
    chequingId,
    memberId: null,
    cards,
    spendMonths: [addMonthsToMonth(month, -1)],
  });

  const { data: rawTxns, error: txErr } = await supabase
    .from('transactions')
    .select(TRANSACTION_COLUMNS)
    .eq('household_id', householdId)
    .eq('account_id', chequingId)
    .gte('date', anchors[0].date)
    .lte('date', windowEnd)
    .order('date', { ascending: true });
  if (txErr) throw new Error(`transactions read failed: ${txErr.message}`);

  const result = buildCashTimeline({
    anchors,
    transactions: toTimelineTxs((rawTxns ?? []) as unknown as Record<string, unknown>[]),
    windowStart,
    windowEnd,
    today,
  });
  if (!result.ok) return null;

  const view = buildMonthView(result.days, [], result.openingBalance, result.balancesStartDate, month);
  if (!view) return null;

  const firstBelow = result.days.find((d) => d.date.startsWith(month) && d.endOfDayBalance < 0);
  return {
    month,
    lowestBalance: view.lowest.balance,
    lowestDate: view.lowest.date,
    anyDayBelowZero: firstBelow !== undefined,
    ...(firstBelow ? { firstDayBelowZero: firstBelow.date } : {}),
  };
}
