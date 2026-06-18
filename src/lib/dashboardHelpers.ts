/**
 * Dashboard aggregation helpers.
 *
 * DOUBLE-COUNT RULE
 * -----------------
 * A household's true money-out for a month is chequing outflow only.
 * Card expenses appear in chequing as bridge payment lines the following
 * month, so naively summing all expense transactions across all accounts
 * would count card spending twice (once as the card transaction, once as
 * the bridge payment). We avoid this by restricting money-out to
 * transactions whose account_id belongs to a chequing account.
 * Bridge lines (is_bridge = true) live on chequing and are correctly
 * included by this rule.
 */

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

  for (const tx of transactions) {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      income += amt;
    } else if (tx.type === 'expense' && tx.account_id !== null && chequingIds.has(tx.account_id)) {
      // Only chequing outflows count as household money-out.
      // Card expense rows are excluded here; they are captured next month
      // as bridge payment lines on chequing.
      expenses += amt;
    }
  }

  return {
    totalIncome:   Math.round(income   * 100) / 100,
    totalExpenses: Math.round(expenses * 100) / 100,
    netCashFlow:   Math.round((income - expenses) * 100) / 100,
  };
}
