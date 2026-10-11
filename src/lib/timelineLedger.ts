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
