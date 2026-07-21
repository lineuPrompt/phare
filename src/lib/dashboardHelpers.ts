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
 * INCOME SCOPE — Phase 1 fix (2026-07-16)
 * ----------------------------------------
 * Income is scoped to chequing for the exact same reason as the double-count
 * rule above: a "money in" entry recorded ON A CARD is a refund/credit
 * against that card's spend (see envelopeHelpers.ts), not new household
 * cash — no money actually entered chequing. Previously `income` summed
 * type='income' across ALL accounts unconditionally, so a card refund
 * inflated totalIncome here while `chequingLedgerNet` (reconcileHelpers.ts'
 * independent path 2) correctly excluded it as a non-chequing row — a real,
 * persistent dual-path reconciliation mismatch (this file's income bucket
 * disagreeing with the chequing ledger's own inflows) any time a card
 * refund existed, not something a bridge-timing fix could touch. Fixed by
 * scoping income to chequing, same as expenses/savings below.
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
 *   income   = Σ amount WHERE type = 'income'  AND account_id ∈ chequing
 *   expenses = Σ amount WHERE type = 'expense' AND account_id ∈ chequing
 *   savings  = Σ amount WHERE type = 'transfer' AND account_id ∈ chequing
 *   net      = income − expenses − savings
 *
 * The goal-side transfer rows (account_id ∈ goal accounts) fall through all
 * predicates and are intentionally counted in zero buckets. Same now for a
 * card-side income (refund) row.
 */

// 'debt' (Build 4 Phase 3): a goal account with a negative balance, target 0
// by default, paid down via recurring transfers — same balance derivation
// (Σ transfer transactions), no separate concept or interest modeling.
export const GOAL_ACCOUNT_TYPES = ['savings', 'tfsa', 'rrsp', 'debt'] as const;
export type GoalAccountType = (typeof GOAL_ACCOUNT_TYPES)[number];

export type TxRow = {
  amount: number | string;
  type: string;
  account_id: string | null;
  // Optional here — computeMonthTotals doesn't need it (callers already
  // date-scope their query). computeGoalBalance below requires it at
  // runtime for its today cutoff; a row with no date is excluded, never
  // assumed to be in the past.
  date?: string;
};

export type AccountRow = {
  id: string;
  type: string;
  // Sinking-fund cash buffer flagged on a 'savings'-type account (Build 4
  // Part 2, 2026-07-21). Undefined/false everywhere else — a real savings
  // goal never sets this. A fund's expense rows (paying its annual bill
  // straight from the fund) are the one case where money leaves the
  // household from a NON-chequing account for good, unlike a card expense
  // which always bridges back through chequing next month — so both the
  // expense bucket below and computeGoalBalance need to know about it.
  is_sinking_fund?: boolean;
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
  // A sinking-fund bill payment is the one expense that never bridges
  // through chequing — it's recorded straight on the fund account and the
  // money leaves the household for good right there. Every other
  // non-chequing expense (a card purchase) instead becomes a chequing
  // bridge line next month, which is why chequing-only scoping is correct
  // for those and would silently drop a fund-paid bill if left unchanged.
  const sinkingFundIds = new Set(
    accounts.filter((a) => a.is_sinking_fund).map((a) => a.id)
  );

  let income = 0;
  let expenses = 0;
  let savings = 0;

  for (const tx of transactions) {
    const amt = Number(tx.amount);
    const onChequing = tx.account_id !== null && chequingIds.has(tx.account_id);
    const onSinkingFund = tx.account_id !== null && sinkingFundIds.has(tx.account_id);

    if (tx.type === 'income' && onChequing) {
      income += amt;
    } else if (tx.type === 'expense' && (onChequing || onSinkingFund)) {
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
 * Derives a goal account's CURRENT balance from its transaction ledger.
 * Balance = sum of all transfer inflows into this account DATED ON OR
 * BEFORE `today`. No static current_balance column is used or trusted.
 *
 * CONTRACT: caller MUST pass the account's FULL transaction history across
 * ALL time — never a month-scoped slice. A partial slice underestimates the
 * balance by omitting older deposits.
 *
 * TODAY CUTOFF — Phase 3 round-2 fix (2026-07-17)
 * --------------------------------------------------
 * Recurring transfers materialize 12 months of REAL, future-dated
 * transaction rows (Phase 2) the moment a rule is created — that's correct
 * for the timeline, which shows real future entries. But it means "full
 * history" now legitimately includes rows that haven't happened yet, and a
 * "current balance" must not count them: a debt with an opening -$500 and
 * twelve materialized future $500 payments would otherwise show $5,500
 * "currently owed" and read as paid off, months before a single payment
 * actually lands. A row with no date at all is excluded, never assumed to
 * be in the past.
 */
/**
 * EXPENSE OUTFLOWS (Build 4 Part 2, 2026-07-21): a sinking fund is a cash
 * buffer that fills AND drains — a bill paid straight from the fund is a
 * real `type='expense'` row on the fund account, and must reduce its
 * balance the same way a transfer inflow increases it. A goal/debt account
 * never carries expense rows today, so adding this subtraction is additive
 * and does not change any existing goal/debt balance.
 */
export function computeGoalBalance(
  transactions: TxRow[],
  goalAccountId: string,
  today: string
): number {
  const total = transactions
    .filter((tx) =>
      tx.account_id === goalAccountId &&
      (tx.type === 'transfer' || tx.type === 'expense') &&
      tx.date !== undefined && tx.date <= today
    )
    .reduce((sum, tx) => {
      const amt = Number(tx.amount);
      return sum + (tx.type === 'expense' ? -amt : amt);
    }, 0);
  return Math.round(total * 100) / 100;
}
