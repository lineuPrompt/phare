import type { CardCycleRemainder } from '@/lib/projectionHelpers';

export type DashboardSummary = {
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  netCashFlow: number;
};

// Informational only (Build 4 Part A, 2026-07-21 revision) — one shared
// buffer funds every sinking fund now, so a per-fund balance/fundedAlready
// would just repeat the SAME shared number on every row. See SinkingFundBuffer
// for the one real balance.
export type SinkingFund = {
  id: string;
  name: string;
  annual_amount: number;
  monthly_provision: number;
  due_month: number | null;
  // Soft exclude flag (2026-07-22) — false means this line is skipped from
  // the buffer's contribution sum but kept on record, re-includable later.
  // Always true on the dashboard's card (that route only ever fetches
  // active rows); only the management page ever sees false.
  active: boolean;
};

// The ONE real cash buffer funding every sinking fund (Build 4 Part A,
// 2026-07-21). No family runs seven separate sinking accounts — every
// sinking_funds row shares this same account once started.
export type SinkingFundBuffer = {
  // null = not started yet — no account/recurring contribution exists.
  linkedAccountId: string | null;
  // Real balance derived from the linked account's ledger — 0 until started.
  balance: number;
  // Mirrors the goals' real-vs-planned signal: true only once real money has
  // actually accumulated (balance > 0), not just "has an account" — a buffer
  // whose first contribution hasn't posted yet still reads as planned.
  fundedAlready: boolean;
  // Sum of every sinking fund's monthly_provision — what "Start your sinking
  // fund" would contribute (or already does) per month.
  totalMonthlyProvision: number;
};

export type GoalTransfer = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
};

export type RecurringContribution = {
  recurringItemId: string;
  amount: number;
  cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
  anchorDate: string | null; // null = needs a date, not yet materializing
  secondDay: number | null;
};

export type DebtPayoff = {
  description: string;
  targetDate: string; // YYYY-MM
  monthlyPayment: number;
};

export type GoalAccount = {
  id: string;
  name: string;
  type: string;
  isDebt: boolean;
  balance: number;
  goalTarget: number | null;
  goalTargetDate: string | null;
  // Code-computed verdict (evaluateGoals) — null for a debt (see debtPayoff
  // instead) or a goal with no target date set (nothing to verify against).
  // Rendered directly next to the AI review's prose (Part B.6) so a
  // narration that ever drifted from this real verdict would be visibly
  // contradicted on the same screen.
  onTrack: boolean | null;
  monthlyContribution: number | null;
  estimatedDate: string | null; // YYYY-MM
  transfers: GoalTransfer[];
  // Materialized transfer rows dated after today (Phase 2 recurring
  // transfers materialize up to 12 months ahead) — real future entries,
  // shown separately from history, never counted in `balance`.
  upcomingTransfers: GoalTransfer[];
  recurringContribution: RecurringContribution | null;
  debtPayoff: DebtPayoff | null;
};

export type DashboardData = {
  hasPlan: boolean;
  firstName?: string;
  month?: string;       // YYYY-MM-01 — the calendar month actuals are for
  planMonth?: string;   // YYYY-MM-01 — the month the saved budget references
  summary?: DashboardSummary;
  categories?: { name: string; type: string; amount: number }[];
  sinkingFunds?: SinkingFund[];
  sinkingFundBuffer?: SinkingFundBuffer;
  goalAccounts?: GoalAccount[];
  review?: string | null;
  topRecommendation?: string | null;
  reviewDate?: string | null;
  // Recurring items (income and expense) with a real cadence/amount but no
  // known pay date yet — not materialized, so this month's totals can look
  // lower than the plan's until a pay date is set on the Recurring page.
  unanchoredIncomeCount?: number;
  unanchoredExpenseCount?: number;
  // YYYY-MM of the chequing account's earliest balance anchor, or null if
  // none exists — the snapshot's lower navigation bound, matching Timeline's.
  earliestAnchorMonth?: string | null;
  // Each card's unspent envelope room for the statement cycle whose payment
  // lands in `month` — feeds the "Projected month-end" tile's
  // computeProjectedMonthEnd. [] when the household has no credit cards.
  cardEnvelopeRemainders?: CardCycleRemainder[];
};

export function formatCurrency(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}

export function monthName(n: number | null, locale: string) {
  if (!n) return '';
  return new Date(2026, n - 1, 1).toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA',
    { month: 'long' }
  );
}

export function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
