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
 * A transfer (chequing ↔ goal account) is neither income nor expense.
 * It creates two linked rows (transfer_peer_id):
 *   - chequing row: type='transfer', counted as savings (contribution) or
 *     borrowed (draw) — see DEBT DRAWS below.
 *   - goal row:     type='transfer', counted in no bucket (goal balance only)
 *
 * DEBT DRAWS (2026-08-01) — borrowed cash is not income
 * -------------------------------------------------------
 * Drawing on a credit line (create_transfer with p_kind='draw') is the
 * mirror of a debt payment: chequing gets real cash, the debt account owes
 * more. It is stored as a chequing-side 'transfer' row with a NEGATIVE
 * amount (contributions/payments are always positive — see create_transfer's
 * migration comment for why the sign alone is enough to tell them apart, no
 * extra column needed). That cash is real and does increase the real
 * running chequing balance (timelineHelpers.ts), but it must NEVER read as
 * surplus: a household that only "balanced" by borrowing did not have a good
 * month. So a negative chequing-side transfer is excluded from `savings`
 * entirely and instead sums into `totalBorrowed`, which `netCashFlow` never
 * includes. Any consumer computing "how much room does this household have"
 * (the surplus tile, the projection tile, and eventually a coaching layer's
 * typical-surplus/sourcing contract) must read netCashFlow, never a raw
 * income/inflow figure that borrowed cash could be sitting inside.
 *
 * DEBT PAYMENTS vs SAVINGS — classification split (2026-08-01)
 * -----------------------------------------------------------
 * A contribution/payment transfer (amount >= 0, the non-draw case above) was
 * previously always counted as `savings`, whether it landed on a savings/
 * TFSA/RRSP/sinking-fund account OR a debt account. Paying down a credit
 * line isn't saving — it reads as the household setting money aside when it
 * actually reduced what it owes, the reconcile screen's own equivalent of
 * the borrowed-cash mislabeling problem. So a chequing-side contribution row
 * is now classified by its DESTINATION: resolved via transfer_peer_id to the
 * paired goal-side row, then that row's account type. A debt destination →
 * `debtPayments`; anything else (savings/tfsa/rrsp/a sinking fund) →
 * `savings`, unchanged. If the peer link can't be resolved (transfer_peer_id
 * missing from the caller's query, or a legacy row predating the RPC's peer-
 * linking — resolvePair, api/transfers/[id]/route.ts, has handled this same
 * possibility since 2026-07-19) the row falls back to `savings`, its
 * original bucket — never silently dropped from both.
 *
 * This is a presentation/classification split ONLY: `savings` + `debtPayments`
 * together always equal what the single old `savings` bucket used to be, for
 * any given month, so netCashFlow's actual computed VALUE is unchanged —
 * only which bucket a debt-payment row's amount is reported under changes.
 *
 * BUCKET MATH
 * -----------
 *   income       = Σ amount WHERE type = 'income'  AND account_id ∈ chequing
 *   expenses     = Σ amount WHERE type = 'expense' AND account_id ∈ chequing
 *   savings      = Σ amount WHERE type = 'transfer' AND account_id ∈ chequing
 *                    AND amount >= 0 AND destination NOT a debt account
 *   debtPayments = Σ amount WHERE type = 'transfer' AND account_id ∈ chequing
 *                    AND amount >= 0 AND destination IS a debt account
 *   borrowed     = Σ -amount WHERE type = 'transfer' AND account_id ∈ chequing AND amount < 0
 *   net          = income − expenses − savings − debtPayments   (borrowed excluded, always)
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
  // Both optional — only needed for computeMonthTotals's debt-payment vs
  // savings split. `transfer_peer_id` on a chequing-side transfer row points
  // at its paired goal-side row's `id`; that peer's account type decides the
  // bucket. If either is missing (a caller that didn't select them, or a
  // legacy row whose peer link was never written — the same possibility
  // api/transfers/[id]/route.ts's resolvePair already tolerates) the row
  // falls back to `savings`, its pre-split bucket — never a crash, never a
  // silently dropped row.
  id?: string;
  transfer_peer_id?: string | null;
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
  // Contributions to a savings/TFSA/RRSP/sinking-fund account only — a debt
  // payment is no longer counted here. See DEBT PAYMENTS vs SAVINGS above.
  totalSavings: number;
  totalExpenses: number;
  // Payments to a debt account this month — split out of `totalSavings`
  // (2026-08-01): paying down a credit line is not saving. Still a chequing
  // outflow, still subtracted in netCashFlow exactly as it was when it lived
  // inside `totalSavings` — this is a classification change, not a math one.
  totalDebtPayments: number;
  // Real cash drawn into chequing from a debt account this month (a credit-
  // line/loan draw). Excluded from netCashFlow — see DEBT DRAWS above. Any
  // "how much can this household afford" computation (surplus tile,
  // projection tile, future coaching sourcing contract) must treat this as
  // NOT available capacity.
  totalBorrowed: number;
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
  // Debt-payment vs savings split (2026-08-01) — see DEBT PAYMENTS vs SAVINGS
  // above. Only need the id, not the whole row: a chequing-side transfer's
  // destination type is looked up by resolving its transfer_peer_id against
  // this set.
  const debtAccountIds = new Set(
    accounts.filter((a) => a.type === 'debt').map((a) => a.id)
  );
  // id → row, for the transfer_peer_id lookup above. Rows without an `id`
  // (a caller that didn't select it) simply never match as anyone's peer —
  // same safe "falls back to savings" outcome as a missing transfer_peer_id.
  const byId = new Map(
    transactions.filter((tx) => tx.id !== undefined).map((tx) => [tx.id as string, tx])
  );

  let income = 0;
  let expenses = 0;
  let savings = 0;
  let debtPayments = 0;
  let borrowed = 0;

  for (const tx of transactions) {
    const amt = Number(tx.amount);
    const onChequing = tx.account_id !== null && chequingIds.has(tx.account_id);
    const onSinkingFund = tx.account_id !== null && sinkingFundIds.has(tx.account_id);

    if (tx.type === 'income' && onChequing) {
      income += amt;
    } else if (tx.type === 'expense' && (onChequing || onSinkingFund)) {
      expenses += amt;
    } else if (tx.type === 'transfer' && onChequing) {
      // Chequing-side row of a chequing↔goal pair. A draw (amount < 0, see
      // DEBT DRAWS above) is real cash but borrowed, not earned — counted
      // separately as `borrowed`, never folded into savings, debtPayments,
      // or netCashFlow. A contribution/payment (amount >= 0) is money
      // genuinely leaving chequing toward a goal — classified by
      // destination: a debt account → debtPayments, anything else →
      // savings (its original, pre-split bucket). The goal-side peer row
      // (type='transfer', goal account_id) is not on chequing, so it falls
      // through and is counted in no bucket either way.
      if (amt < 0) {
        borrowed += -amt;
      } else {
        const peer = tx.transfer_peer_id != null ? byId.get(tx.transfer_peer_id) : undefined;
        const peerIsDebt = peer?.account_id != null && debtAccountIds.has(peer.account_id);
        if (peerIsDebt) {
          debtPayments += amt;
        } else {
          savings += amt;
        }
      }
    }
  }

  return {
    totalIncome:       Math.round(income       * 100) / 100,
    totalExpenses:     Math.round(expenses     * 100) / 100,
    totalSavings:      Math.round(savings      * 100) / 100,
    totalDebtPayments: Math.round(debtPayments * 100) / 100,
    totalBorrowed:     Math.round(borrowed     * 100) / 100,
    // Unchanged formula in spirit — savings + debtPayments together equal
    // exactly what the single pre-split `savings` total used to be, so this
    // number is identical to what netCashFlow returned before the split.
    netCashFlow: Math.round((income - expenses - savings - debtPayments) * 100) / 100,
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
 *
 * DEBT DRAWS (2026-08-01): a draw's debt-side row is a 'transfer' row with a
 * NEGATIVE amount (create_transfer, p_kind='draw') — summed directly below
 * with no special-casing, same as every other transfer row. This already
 * worked before draws existed: the debt opening-balance seed (POST
 * /api/accounts) has stored a literal negative amount here from the start.
 * A draw simply makes the balance more negative (owe more), a payment more
 * positive (owe less) — one formula, no branch on kind.
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
