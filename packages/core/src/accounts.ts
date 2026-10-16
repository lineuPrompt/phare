/**
 * accounts.ts — which account types exist for goals, and which may carry a
 * stated opening balance.
 *
 * Moved here from the web app's src/lib/dashboardHelpers.ts (2026-10-16) so
 * the Expo app's "add an account" form asks for a starting balance on exactly
 * the types the server accepts one for. dashboardHelpers.ts re-exports both,
 * so no web import site changed.
 */

// 'debt' (Build 4 Phase 3): a goal account with a negative balance, target 0
// by default, paid down via recurring transfers — same balance derivation
// (Σ transfer transactions), no separate concept or interest modeling.
export const GOAL_ACCOUNT_TYPES = ['savings', 'tfsa', 'rrsp', 'debt'] as const;
export type GoalAccountType = (typeof GOAL_ACCOUNT_TYPES)[number];

/**
 * May this account type carry a stated opening balance — a one-sided
 * 'Starting balance' transfer row seeding money the household already had
 * before Phare?
 *
 * Only goal accounts, and the rule is structural rather than stylistic:
 *
 *  - chequing's balance is derived from account_balance_anchors plus its own
 *    ledger (timelineHelpers). A positive transfer row ON chequing is read as
 *    a contribution leaving the account: it inflates totalSavings, drops
 *    netCashFlow by the same amount, walks the Timeline's running balance
 *    down on top of the anchor that already stated it, and — since the
 *    Timeline selects rows by account_id — appears as a movement that never
 *    happened, which is the exact thing an opening balance exists to avoid.
 *
 *    Reconciliation does NOT catch this. Both derivation paths classify a
 *    positive chequing transfer as an outflow, so they agree on the wrong
 *    number (measured in openingBalanceInvariant.test.ts). That is why the
 *    rule is enforced here and by a database trigger, rather than left for
 *    the audit to notice.
 *  - credit_card / line_of_credit balances are envelope-derived (signedAmount
 *    over card rows); a transfer row there means nothing to that derivation.
 *
 * A goal account's balance is Σ its own transfer/expense rows
 * (computeGoalBalance), so a seed row is simply part of the sum — which is
 * why the mechanism is correct there and nowhere else.
 */
export function acceptsOpeningBalance(accountType: string): boolean {
  return (GOAL_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}
