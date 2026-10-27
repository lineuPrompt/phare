import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimelineTx } from './timelineHelpers';

// ---------------------------------------------------------------------------
// The chequing ledger rows the Cash Timeline walks, and how they are read.
//
// Moved verbatim out of GET /api/timeline (2026-10-10) so the monthly review's
// "month ahead" reads the ledger exactly as the Timeline does, from one
// definition, instead of a second column list that could drift from it.
// ---------------------------------------------------------------------------

export const TRANSACTION_COLUMNS =
  'id, date, description, amount, type, recurring_item_id, recurrence_id, installment_label, transfer_peer_id, is_bridge, bridge_source_account, bridge_source_month';
const VALID_TX_TYPES = new Set(['income', 'expense', 'transfer']);

export function toTimelineTxs(rows: Record<string, unknown>[]): TimelineTx[] {
  return rows
    .filter((t) => VALID_TX_TYPES.has(String(t.type)))
    .map((t) => ({
      id: t.id as string,
      date: t.date as string,
      description: (t.description ?? null) as string | null,
      amount: Number(t.amount),
      type: t.type as 'income' | 'expense' | 'transfer',
      recurringItemId: (t.recurring_item_id ?? null) as string | null,
      recurrenceId: (t.recurrence_id ?? null) as string | null,
      installmentLabel: (t.installment_label ?? null) as string | null,
      transferPeerId: (t.transfer_peer_id ?? null) as string | null,
      isBridge: Boolean(t.is_bridge),
      bridgeSourceAccount: (t.bridge_source_account ?? null) as string | null,
      bridgeSourceMonth: (t.bridge_source_month ?? null) as string | null,
    }));
}

/**
 * Marks each draw (a negative chequing-side transfer) whose other side is a
 * savings-type account as a withdrawal, so the Timeline does not label the
 * household's own savings as borrowed money (2026-10-27). The source is the
 * peer row's account type — the same rule computeMonthTotals uses. A draw
 * whose peer cannot be found stays a plain draw, as before. A failed read
 * throws: the caller reports it rather than guessing.
 */
export async function markWithdrawals(
  supabase: SupabaseClient,
  householdId: string,
  txs: TimelineTx[]
): Promise<TimelineTx[]> {
  const peerIds = [...new Set(
    txs.filter((t) => t.type === 'transfer' && t.amount < 0 && t.transferPeerId).map((t) => t.transferPeerId as string)
  )];
  if (peerIds.length === 0) return txs;

  const { data: peers, error: peerErr } = await supabase
    .from('transactions')
    .select('id, account_id')
    .eq('household_id', householdId)
    .in('id', peerIds);
  if (peerErr) throw new Error(`draw peers read failed: ${peerErr.message}`);

  const accountIds = [...new Set((peers ?? []).map((p) => p.account_id as string | null).filter((id): id is string => !!id))];
  const { data: accounts, error: acctErr } = accountIds.length === 0
    ? { data: [], error: null }
    : await supabase.from('accounts').select('id, type').eq('household_id', householdId).in('id', accountIds);
  if (acctErr) throw new Error(`draw accounts read failed: ${acctErr.message}`);

  const savingsTypes = new Set(['savings', 'tfsa', 'rrsp']);
  const savingsAccounts = new Set((accounts ?? []).filter((a) => savingsTypes.has(a.type as string)).map((a) => a.id as string));
  const withdrawalPeers = new Set((peers ?? []).filter((p) => savingsAccounts.has(p.account_id as string)).map((p) => p.id as string));

  return txs.map((t) =>
    t.type === 'transfer' && t.amount < 0 && t.transferPeerId && withdrawalPeers.has(t.transferPeerId)
      ? { ...t, isWithdrawal: true }
      : t
  );
}
