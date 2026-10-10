import { buildMonthView, businessMonth, DEFAULT_HOUSEHOLD_TIMEZONE } from '@phare/core';
import type { Getter } from './timelineLoader';
import type { AccountsResponse, TimelineOk, TimezoneResponse } from './timeline';

// ---------------------------------------------------------------------------
// The Home tab: the web dashboard's snapshot and Plan card, current month only.
//
// EVERY FIGURE IS THE SERVER'S. The subtraction (income, expenses, savings,
// debt payments, surplus) is computeMonthTotals, from /api/dashboard. The plan
// balance and its per-card lines are buildPlanChain, from /api/timeline. The
// two real balances are buildMonthView over the route's own day list — the
// same @phare/core function, the same slice, the web dashboard makes. Nothing
// here adds or subtracts.
//
// snapshotOnly=1, ALWAYS. The full dashboard load also reads the review and
// logs `viewed_monthly_review`; this screen shows no review, so it must not
// claim one was seen. Same reason the household gate sends it.
//
// NO pageView ON THE TIMELINE REQUEST. That flag logs `timeline_opened`, and
// opening Home is not opening the Timeline.
//
// A MISSING FIGURE IS AN ERROR, NOT A ZERO. Every amount is checked to be a
// real number before it reaches the screen; a payload without one throws, and
// the screen shows the error with a retry.
//
// CURRENT MONTH ONLY. That is also what keeps the projection horizon off this
// screen: the current month is always the first month of the chain, which
// every household receives.
// ---------------------------------------------------------------------------

/** How a card's cost entered the plan. Mirrors CardCostBasis on the web. */
export type CardBasis = 'actual' | 'budget' | 'max' | 'posted';

/** One month of GET /api/timeline?includePlan=1 → plan.months, as the route sends it. */
type PlanMonthPayload = {
  month: string;
  isPartialMonth: boolean;
  balance: number;
  cardCost: { cardId: string; cardName: string; basis: CardBasis; amount: number }[];
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
};

type HomeTimelineResponse =
  | (TimelineOk & { plan: { months: PlanMonthPayload[] } | null })
  | { ok: false; reason: 'no_anchor' };

/** GET /api/dashboard?snapshotOnly=1. */
type SnapshotResponse = {
  hasPlan?: unknown;
  month?: unknown;
  summary?: {
    totalIncome?: unknown;
    totalExpenses?: unknown;
    totalSavings?: unknown;
    totalDebtPayments?: unknown;
    totalBorrowed?: unknown;
    netCashFlow?: unknown;
    savingsByDestination?: { accountId: string | null; name: string | null; amount: unknown }[];
  };
  unanchoredIncomeCount?: unknown;
  unanchoredExpenseCount?: unknown;
};

export type HomeSnapshot = {
  income: number;
  expenses: number;
  savings: number;
  /** Where the savings went. `name: null` is a destination that can no longer be named. */
  savingsLines: { key: string; name: string | null; amount: number }[];
  /** Shown as a row only when above zero, as on the web. */
  debtPayments: number;
  /** Surplus when >= 0, deficit otherwise. */
  netCashFlow: number;
  /** Cash drawn from a debt account this month. Never part of netCashFlow. */
  borrowed: number;
  /** Recurring lines with no date yet: this month's totals may be missing them. */
  awaitingDates: boolean;
};

export type HomePlan =
  /** No chequing account, or no real balance set yet. Both are set on the web. */
  | { kind: 'noAnchor' }
  /** The route sent no plan for this month. Nothing is shown, as on the web. */
  | { kind: 'hidden' }
  | {
      kind: 'ready';
      /** Real balance at the end of the month's last known day. */
      realClose: number | null;
      /** Real balance carried in from before the month. */
      carriedIn: number | null;
      /** The plan's balance at month end. */
      balance: number;
      isPartialMonth: boolean;
      cards: { cardId: string; cardName: string; basis: CardBasis; amount: number }[];
      awaitingDates: boolean;
    };

export type HomeLoad = { month: string; snapshot: HomeSnapshot; plan: HomePlan };

export function homeSnapshotPath(month: string): string {
  return `/api/dashboard?month=${encodeURIComponent(month)}&snapshotOnly=1`;
}

export function homeTimelinePath(accountId: string): string {
  return `/api/timeline?account=${encodeURIComponent(accountId)}&includePlan=1`;
}

function amount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`home: ${name} is not a number`);
  }
  return value;
}

const BASES: readonly string[] = ['actual', 'budget', 'max', 'posted'];

function snapshotFrom(data: SnapshotResponse, month: string): HomeSnapshot {
  // The gate only lets a household with a plan reach the tabs. One without
  // here means the two reads disagree — refuse rather than draw an empty month.
  if (data?.hasPlan !== true) throw new Error('home: /api/dashboard answered without a plan');

  // The route echoes the month it computed, as 'YYYY-MM-01'. A mismatch means
  // the figures belong to another month than the heading would claim.
  if (data.month !== `${month}-01`) {
    throw new Error(`home: dashboard answered for ${String(data.month)}, asked for ${month}`);
  }

  const s = data.summary;
  if (!s) throw new Error('home: /api/dashboard answered without a summary');

  return {
    income: amount(s.totalIncome, 'totalIncome'),
    expenses: amount(s.totalExpenses, 'totalExpenses'),
    savings: amount(s.totalSavings, 'totalSavings'),
    savingsLines: (s.savingsByDestination ?? []).map((line) => ({
      key: line.accountId ?? '__other__',
      name: line.name ?? null,
      amount: amount(line.amount, 'savingsByDestination.amount'),
    })),
    debtPayments: amount(s.totalDebtPayments, 'totalDebtPayments'),
    netCashFlow: amount(s.netCashFlow, 'netCashFlow'),
    borrowed: amount(s.totalBorrowed, 'totalBorrowed'),
    awaitingDates:
      amount(data.unanchoredIncomeCount, 'unanchoredIncomeCount') +
        amount(data.unanchoredExpenseCount, 'unanchoredExpenseCount') >
      0,
  };
}

function planFrom(data: HomeTimelineResponse, month: string): HomePlan {
  if (!data.ok) return { kind: 'noAnchor' };

  const planMonth = data.plan?.months.find((m) => m.month === month) ?? null;
  if (!planMonth) return { kind: 'hidden' };

  const view = buildMonthView(
    data.days,
    data.unbalancedDays ?? [],
    data.openingBalance,
    data.balancesStartDate,
    month
  );

  return {
    kind: 'ready',
    realClose: view ? view.closesAt : null,
    carriedIn: view ? view.opensAt : null,
    balance: amount(planMonth.balance, 'plan balance'),
    isPartialMonth: planMonth.isPartialMonth === true,
    cards: planMonth.cardCost.map((c) => {
      if (!BASES.includes(c.basis)) throw new Error(`home: unknown card basis "${String(c.basis)}"`);
      return {
        cardId: c.cardId,
        cardName: c.cardName,
        basis: c.basis,
        amount: amount(c.amount, 'card cost'),
      };
    }),
    awaitingDates:
      amount(planMonth.unanchoredIncomeCount, 'plan unanchoredIncomeCount') +
        amount(planMonth.unanchoredExpenseCount, 'plan unanchoredExpenseCount') >
      0,
  };
}

export async function loadHome(get: Getter, at: () => Date = () => new Date()): Promise<HomeLoad> {
  const [accounts, timezone] = await Promise.all([
    get<AccountsResponse>('/api/accounts'),
    get<TimezoneResponse>('/api/household/timezone'),
  ]);

  // The household's month, never the device's. Timezone failure propagates,
  // for the reason timelineLoader.ts gives.
  const month = businessMonth(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at());
  const chequing = accounts.accounts.find((account) => account.type === 'chequing');

  const [dashboard, timeline] = await Promise.all([
    get<SnapshotResponse>(homeSnapshotPath(month)),
    chequing ? get<HomeTimelineResponse>(homeTimelinePath(chequing.id)) : Promise.resolve(null),
  ]);

  return {
    month,
    snapshot: snapshotFrom(dashboard, month),
    plan: timeline ? planFrom(timeline, month) : { kind: 'noAnchor' },
  };
}
