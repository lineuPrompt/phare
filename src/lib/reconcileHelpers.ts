/**
 * Reconciliation helpers — two genuinely independent derivation paths.
 *
 * Path 1 (buckets): delegates to computeMonthTotals.
 * Path 2 (chequing ledger): sums chequing transactions by sign directly,
 *   without touching computeMonthTotals.  If both nets are equal the ledger
 *   is internally consistent.  A delta means a classification bug.
 */

import { computeMonthTotals, AccountRow, TxRow } from './dashboardHelpers';

// Full transaction row needed by the audit — extends the minimal TxRow
// with display fields and the bridge flag.
export type ReconcileTxRow = TxRow & {
  id: string;
  date: string;
  description: string | null;
  is_bridge?: boolean | null;
  categoryName?: string | null;
  installment_label?: string | null;
};

// AccountRow extended with a display name for the audit table.
export type ReconcileAccountRow = AccountRow & {
  name: string;
};

export type TransactionAuditLine = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  type: string;
  isBridge: boolean;
  categoryName: string | null;
  installmentLabel: string | null;
};

export type AccountAudit = {
  accountId: string;
  accountName: string;
  accountType: string;
  /** Net signed balance change for this account in the month. */
  monthBalance: number;
  transactions: TransactionAuditLine[];
};

export type ReconciliationResult = {
  // Bucket path — via computeMonthTotals (path 1)
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  /** Card→chequing bridge lines, a subset of totalExpenses — shown separately. */
  totalBridgePayments: number;
  netFromBuckets: number;

  // Chequing-ledger path — independent derivation (path 2)
  netFromChequing: number;

  // Match
  netDifference: number;
  reconciled: boolean;

  accounts: AccountAudit[];
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Path 2 — real household cash net, derived directly from the ledger.
 *
 * Signs: income = inflow (+), expense = outflow (−), transfer on chequing = outflow (−).
 * Chequing rows are always considered. A sinking-fund account's expense rows
 * are ALSO considered (Build 4 Part 2, 2026-07-21) — a bill paid straight
 * from the fund is real money leaving the household for good, unlike a card
 * expense, which always bridges back through chequing next month and so is
 * correctly left out here. This function never calls computeMonthTotals so
 * the two paths are genuinely independent — both had to learn this same new
 * fact for a fund-paid bill to keep the two paths agreeing.
 */
export function chequingLedgerNet(
  transactions: ReconcileTxRow[],
  accounts: ReconcileAccountRow[]
): number {
  const chequingIds = new Set(
    accounts.filter((a) => a.type === 'chequing').map((a) => a.id)
  );
  const sinkingFundIds = new Set(
    accounts.filter((a) => a.is_sinking_fund).map((a) => a.id)
  );

  let inflows = 0;
  let outflows = 0;

  for (const tx of transactions) {
    if (tx.account_id === null) continue;
    const onChequing = chequingIds.has(tx.account_id);
    const onSinkingFund = sinkingFundIds.has(tx.account_id);
    if (!onChequing && !onSinkingFund) continue;

    const amt = Number(tx.amount);
    if (tx.type === 'income' && onChequing) {
      inflows += amt;
    } else if (tx.type === 'expense' && (onChequing || onSinkingFund)) {
      outflows += amt;
    } else if (tx.type === 'transfer' && onChequing) {
      outflows += amt;
    }
  }

  return r2(inflows - outflows);
}

/**
 * Full month reconciliation.
 *
 * Returns the bucket breakdown (path 1), the chequing-ledger net (path 2),
 * the difference between them, a reconciled flag, and per-account audit rows.
 *
 * The two net values should be equal when the ledger is internally consistent.
 * Any non-zero difference points to a classification or double-count bug.
 */
export function reconcileMonth(
  transactions: ReconcileTxRow[],
  accounts: ReconcileAccountRow[]
): ReconciliationResult {
  const chequingIds = new Set(
    accounts.filter((a) => a.type === 'chequing').map((a) => a.id)
  );

  // Path 1 — bucket totals
  const buckets = computeMonthTotals(transactions, accounts);

  // Path 2 — chequing ledger direct (separate function, no shared logic)
  const netFromChequing = chequingLedgerNet(transactions, accounts);
  const netFromBuckets = buckets.netCashFlow;
  const netDifference = r2(netFromChequing - netFromBuckets);

  // Bridge lines — chequing expense rows flagged is_bridge=true
  let totalBridgePayments = 0;
  for (const tx of transactions) {
    if (
      tx.is_bridge &&
      tx.type === 'expense' &&
      tx.account_id !== null &&
      chequingIds.has(tx.account_id)
    ) {
      totalBridgePayments += Number(tx.amount);
    }
  }
  totalBridgePayments = r2(totalBridgePayments);

  // Per-account audit
  const accountAudits: AccountAudit[] = accounts.map((account) => {
    const acctTxns = transactions.filter((tx) => tx.account_id === account.id);

    let monthBalance = 0;
    if (account.type === 'chequing') {
      for (const tx of acctTxns) {
        const amt = Number(tx.amount);
        if (tx.type === 'income') monthBalance += amt;
        else if (tx.type === 'expense' || tx.type === 'transfer') monthBalance -= amt;
      }
    } else if (account.type === 'credit_card') {
      for (const tx of acctTxns) {
        if (tx.type === 'expense') monthBalance += Number(tx.amount);
      }
    } else {
      // Goal accounts: inflows from transfer rows on that account, minus any
      // expense rows on it (a sinking fund's bill paid straight from the
      // fund, Build 4 Part 2) — a real goal/debt account never carries
      // expense rows, so this is additive for them.
      for (const tx of acctTxns) {
        if (tx.type === 'transfer') monthBalance += Number(tx.amount);
        else if (tx.type === 'expense') monthBalance -= Number(tx.amount);
      }
    }

    return {
      accountId: account.id,
      accountName: account.name,
      accountType: account.type,
      monthBalance: r2(monthBalance),
      transactions: acctTxns.map((tx) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: Number(tx.amount),
        type: tx.type,
        isBridge: Boolean(tx.is_bridge),
        categoryName: tx.categoryName ?? null,
        installmentLabel: tx.installment_label ?? null,
      })),
    };
  });

  return {
    totalIncome: buckets.totalIncome,
    totalExpenses: buckets.totalExpenses,
    totalSavings: buckets.totalSavings,
    totalBridgePayments,
    netFromBuckets,
    netFromChequing,
    netDifference,
    reconciled: Math.abs(netDifference) < 0.01,
    accounts: accountAudits,
  };
}
