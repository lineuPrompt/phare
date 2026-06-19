/**
 * Dashboard aggregation helpers.
 *
 * DOUBLE-COUNT RULE
 * -----------------
 * A household's true money-out for a month is chequing outflow only.
 * Card expenses appear in chequing as bridge payment lines the following
 * month, so naively summing all expense transactions across all accounts
 * would count card spending twice. We restrict money-out to transactions
 * whose account_id belongs to a chequing account.
 *
 * TRANSFER RULE
 * -------------
 * A transfer (chequing → goal account) is neither income nor expense.
 * It creates two linked rows (transfer_peer_id):
 *   - chequing row: type='transfer', counted as savings
 *   - goal row:     type='transfer', counted in no bucket (goal balance only)
 *
 * BUCKET MATH
 * -----------
 *   income   = Σ amount WHERE type = 'income'
 *   expenses = Σ amount WHERE type = 'expense'  AND account_id ∈ chequing
 *   savings  = Σ amount WHERE type = 'transfer' AND account_id ∈ chequing
 *   net      = income − expenses − savings
 *
 * The goal-side transfer rows (account_id ∈ goal accounts) fall through all
 * predicates and are intentionally counted in zero buckets.
 */

export const GOAL_ACCOUNT_TYPES = ['savings', 'tfsa', 'rrsp'] as const;
export type GoalAccountType = (typeof GOAL_ACCOUNT_TYPES)[number];

export type TxRow = {
  amount: number | string;
  type: string;
  account_id: string | null;
};

export type AccountRow = {
  id: string;
  type: string;
};

export type MonthTotals = {
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  netCashFlow: number;
};

export function computeMonthTotals(
  transactions: TxRow[],
  accounts: AccountRow[]
): MonthTotals {
  const chequingIds = new Set(
    accounts.filter((a) => a.type === 'chequing').map((a) => a.id)
  );

  let income = 0;
  let expenses = 0;
  let savings = 0;

  for (const tx of transactions) {
    const amt = Number(tx.amount);
    const onChequing = tx.account_id !== null && chequingIds.has(tx.account_id);

    if (tx.type === 'income') {
      income += amt;
    } else if (tx.type === 'expense' && onChequing) {
      expenses += amt;
    } else if (tx.type === 'transfer' && onChequing) {
      // Chequing-side outflow of a chequing→goal pair. Counted as savings.
      // The goal-side peer row (type='transfer', goal account_id) is not on
      // chequing, so it falls through and is counted in no bucket.
      savings += amt;
    }
  }

  return {
    totalIncome:   Math.round(income   * 100) / 100,
    totalExpenses: Math.round(expenses * 100) / 100,
    totalSavings:  Math.round(savings  * 100) / 100,
    netCashFlow:   Math.round((income - expenses - savings) * 100) / 100,
  };
}

/**
 * Derives a goal account's current balance from its transaction ledger.
 * Balance = sum of all transfer inflows into this account.
 * No static current_balance column is used or trusted.
 */
export function computeGoalBalance(
  transactions: TxRow[],
  goalAccountId: string
): number {
  const total = transactions
    .filter((tx) => tx.account_id === goalAccountId && tx.type === 'transfer')
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  return Math.round(total * 100) / 100;
}
