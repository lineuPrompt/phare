import {
  addMonthsToMonth,
  availableMonths,
  buildMonthView,
  businessMonth,
  DEFAULT_HOUSEHOLD_TIMEZONE,
} from '@phare/core';
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
// MONTH NAVIGATION (2026-10-15), with the web dashboard's range and states:
//   - back to the month of the chequing account's earliest anchor
//     (`earliestAnchorMonth`, which /api/dashboard returns for exactly this);
//     with none, the current month is the floor. The web page has no floor
//     at all then; a month before any known balance has nothing true to say.
//   - forward to the current month + 11 (the web page's maxNavigableMonth),
//     capped at the timeline's horizonEndMonth when it sends one, so the Plan
//     card never goes silent past the horizon. The web page explains that
//     gap with an upgrade prompt; this app may not (Guideline 3.1.1), so it
//     does not navigate into it.
//   - a past month: its actuals, and the Plan card's "already happened"
//     note — the chain starts at the current month, as on the web.
// Paging fetches only that month's snapshot (snapshotOnly), as the web page
// does; the timeline and its plan chain are fetched once per load and reused.
// ---------------------------------------------------------------------------

/** How a card's cost entered the plan. Mirrors CardCostBasis on the web. */
export type CardBasis = 'actual' | 'budget' | 'max' | 'posted';

/** The month's lines, as planChainHelpers.computeMonthBreakdown sends them. */
type LinesPayload = {
  income: unknown; bills: unknown; savings: unknown; debtPayments: unknown;
  savingsByDestination?: { accountId: string | null; name: string | null; amount: unknown }[];
  drawn: unknown; leftAfterBillsAndSavings: unknown; cards: unknown;
};

/** One month of GET /api/timeline?includePlan=1 → plan.months, as the route sends it. */
type PlanMonthPayload = {
  month: string;
  isPartialMonth: boolean;
  balance: number;
  /** inProgress: absent from a server older than 2026-11-13. budget: older than 2026-11-14. */
  cardCost: { cardId: string; cardName: string; basis: CardBasis; amount: number; inProgress?: boolean; budget?: unknown }[];
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
  // Absent from a server older than 2026-11-14 — a future month then keeps
  // the older layout rather than a sum the server never sent.
  startBalance?: unknown;
  breakdown?: { status?: unknown; lines?: LinesPayload };
  why?: { kind?: unknown; [field: string]: unknown } | null;
};

type StatementPayload = { cardId: string; cardName: string; count: unknown; average: unknown };

type HomeTimelineResponse =
  | (TimelineOk & { plan: { months: PlanMonthPayload[]; statementHistory?: StatementPayload[] } | null })
  | { ok: false; reason: 'no_anchor' };

/** GET /api/dashboard?snapshotOnly=1. */
type SnapshotResponse = {
  hasPlan?: unknown;
  month?: unknown;
  /** YYYY-MM of the chequing account's earliest anchor, or null. */
  earliestAnchorMonth?: unknown;
  summary?: {
    totalIncome?: unknown;
    totalExpenses?: unknown;
    totalSavings?: unknown;
    totalDebtPayments?: unknown;
    totalBorrowed?: unknown;
    totalWithdrawn?: unknown;
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
  /** Cash taken back from savings or the Reserve Fund this month. Never part of netCashFlow. */
  withdrawn: number;
  /** Recurring lines with no date yet: this month's totals may be missing them. */
  awaitingDates: boolean;
};

/** One card's line in the plan. inProgress: a statement still running — `amount` is what's on it so far. */
export type HomePlanCard = { cardId: string; cardName: string; basis: CardBasis; amount: number; inProgress: boolean };

/** The month-end path: every month the household can see. */
export type HomePathPoint = { month: string; balance: number };

/** A card's budget for the viewed month beside the average of its real closed statements (the server's), and how many. */
export type HomeStatement = { cardId: string; cardName: string; budget: number | null; count: number; average: number };

/** A future month's sum. Every line is the server's; nothing here is added up. */
export type HomePlanLines = {
  income: number; bills: number; savings: number; debtPayments: number; drawn: number;
  /** Where the savings went — the server's partition, as on the snapshot. `name: null` is "Other". */
  savingsLines: { key: string; name: string | null; amount: number }[];
};

/** Why a month dips — chosen by the server (explainPlanPath), worded here. */
export type HomeWhy =
  | { kind: 'extraPayments'; items: { name: string; occurrences: number; dates: string[] }[] }
  | { kind: 'cardsOverLeft'; cards: number; left: number }
  | { kind: 'startsBelowZero'; startBalance: number; isPartialMonth: boolean }
  | { kind: 'moreOutThanIn'; amount: number };

export type HomePlan =
  /** No chequing account, or no real balance set yet. Both are set on the web. */
  | { kind: 'noAnchor' }
  /** A month before the current one: the plan looks forward, as on the web. */
  | { kind: 'past' }
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
      cards: HomePlanCard[];
      awaitingDates: boolean;
      path: HomePathPoint[];
      statements: HomeStatement[];
    }
  /**
   * The current month and every month after it (2026-11-14): ONE basis, the
   * plan, as a sum that adds up. The current month (isPartialMonth) starts
   * from today's balance. No real-balance lines — they leave out card
   * statements that have not closed yet. `lines: null` is a breakdown the
   * server could not build: the card shows only that message, never a
   * partial sum. (`kind: 'ready'` remains for a server older than this.)
   */
  | {
      kind: 'future';
      isPartialMonth: boolean;
      startBalance: number;
      lines: HomePlanLines | null;
      balance: number;
      cards: HomePlanCard[];
      why: HomeWhy | null;
      awaitingDates: boolean;
      path: HomePathPoint[];
      statements: HomeStatement[];
    };

/** One month of Home. */
export type HomeMonth = { month: string; isPastMonth: boolean; snapshot: HomeSnapshot; plan: HomePlan };

/** What paging needs, fetched once per load. */
export type HomeContext = {
  /** The household's month (businessMonth), YYYY-MM. */
  currentMonth: string;
  /** Ascending YYYY-MM months Home may page through. */
  months: string[];
  /** The timeline with its plan chain; null without a chequing account. */
  timeline: HomeTimelineResponse | null;
};

export type HomeLoad = HomeMonth & { context: HomeContext };

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
    withdrawn: amount(s.totalWithdrawn, 'totalWithdrawn'),
    awaitingDates:
      amount(data.unanchoredIncomeCount, 'unanchoredIncomeCount') +
        amount(data.unanchoredExpenseCount, 'unanchoredExpenseCount') >
      0,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`home: ${name} is not text`);
  return value;
}

function cardsFrom(planMonth: PlanMonthPayload): HomePlanCard[] {
  return planMonth.cardCost.map((c) => {
    if (!BASES.includes(c.basis)) throw new Error(`home: unknown card basis "${String(c.basis)}"`);
    // Absent = a server from before the flag existed: nothing is "so far".
    if (c.inProgress !== undefined && typeof c.inProgress !== 'boolean') {
      throw new Error(`home: card inProgress is not a boolean`);
    }
    return {
      cardId: c.cardId,
      cardName: c.cardName,
      basis: c.basis,
      amount: amount(c.amount, 'card cost'),
      inProgress: c.inProgress === true,
    };
  });
}

function pathFrom(months: PlanMonthPayload[]): HomePathPoint[] {
  return months.map((m) => ({ month: text(m.month, 'path month'), balance: amount(m.balance, 'path balance') }));
}

/** Each card's statements, beside the budget this month's plan used for it (joined by id, not computed). */
function statementsFrom(history: StatementPayload[] | undefined, planMonth: PlanMonthPayload): HomeStatement[] {
  const budgetOf = new Map(planMonth.cardCost.map((c) => [c.cardId, c.budget]));
  return (history ?? []).map((h) => {
    const budget = budgetOf.get(h.cardId);
    return {
      cardId: text(h.cardId, 'statement card id'),
      cardName: text(h.cardName, 'statement card name'),
      budget: budget === undefined || budget === null ? null : amount(budget, 'card budget'),
      count: amount(h.count, 'statement count'),
      average: amount(h.average, 'statement average'),
    };
  });
}

function whyFrom(why: PlanMonthPayload['why']): HomeWhy | null {
  if (why === null || why === undefined) return null;
  switch (why.kind) {
    case 'extraPayments': {
      if (!Array.isArray(why.items)) throw new Error('home: why items is not a list');
      return {
        kind: 'extraPayments',
        items: (why.items as Record<string, unknown>[]).map((item) => {
          if (!Array.isArray(item.dates) || !item.dates.every((d) => typeof d === 'string' && DATE.test(d))) {
            throw new Error('home: why dates are not dates');
          }
          return { name: text(item.name, 'why name'), occurrences: amount(item.occurrences, 'why occurrences'), dates: item.dates as string[] };
        }),
      };
    }
    case 'cardsOverLeft':
      return { kind: 'cardsOverLeft', cards: amount(why.cards, 'why cards'), left: amount(why.left, 'why left') };
    case 'startsBelowZero':
      if (typeof why.isPartialMonth !== 'boolean') throw new Error('home: why isPartialMonth is not a boolean');
      return { kind: 'startsBelowZero', startBalance: amount(why.startBalance, 'why start'), isPartialMonth: why.isPartialMonth };
    case 'moreOutThanIn':
      return { kind: 'moreOutThanIn', amount: amount(why.amount, 'why amount') };
    default:
      throw new Error(`home: unknown why "${String(why.kind)}"`);
  }
}

function linesFrom(breakdown: NonNullable<PlanMonthPayload['breakdown']>): HomePlanLines | null {
  if (breakdown.status === 'error') return null;
  if (breakdown.status !== 'ok' || !breakdown.lines) throw new Error(`home: unknown breakdown "${String(breakdown.status)}"`);
  const l = breakdown.lines;
  return {
    income: amount(l.income, 'lines income'),
    bills: amount(l.bills, 'lines bills'),
    savings: amount(l.savings, 'lines savings'),
    savingsLines: (l.savingsByDestination ?? []).map((line) => ({
      key: line.accountId ?? '__other__',
      name: line.name ?? null,
      amount: amount(line.amount, 'lines savingsByDestination.amount'),
    })),
    debtPayments: amount(l.debtPayments, 'lines debtPayments'),
    drawn: amount(l.drawn, 'lines drawn'),
  };
}

function planFrom(data: HomeTimelineResponse, month: string, currentMonth: string): HomePlan {
  if (!data.ok) return { kind: 'noAnchor' };

  const planMonth = data.plan?.months.find((m) => m.month === month) ?? null;
  if (!planMonth) return { kind: 'hidden' };

  // The viewed month's own balance first: its failure names the figure on screen.
  const balance = amount(planMonth.balance, 'plan balance');
  const awaitingDates =
    amount(planMonth.unanchoredIncomeCount, 'plan unanchoredIncomeCount') +
      amount(planMonth.unanchoredExpenseCount, 'plan unanchoredExpenseCount') >
    0;
  const path = pathFrom(data.plan?.months ?? []);
  const statements = statementsFrom(data.plan?.statementHistory, planMonth);

  if (month >= currentMonth && planMonth.breakdown !== undefined) {
    const lines = linesFrom(planMonth.breakdown);
    return {
      kind: 'future',
      isPartialMonth: planMonth.isPartialMonth === true,
      startBalance: amount(planMonth.startBalance, 'plan startBalance'),
      lines,
      balance,
      cards: cardsFrom(planMonth),
      // A breakdown the server could not build shows only its message.
      why: lines === null ? null : whyFrom(planMonth.why),
      awaitingDates,
      path,
      statements,
    };
  }

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
    balance,
    isPartialMonth: planMonth.isPartialMonth === true,
    cards: cardsFrom(planMonth),
    awaitingDates,
    path,
    statements,
  };
}

/**
 * The months Home pages through. `horizonEndMonth` caps the forward end when
 * the timeline sends one; `earliestAnchorMonth` sets the back end.
 */
export function homeMonths(
  currentMonth: string,
  earliestAnchorMonth: string | null,
  horizonEndMonth: string | null
): string[] {
  const floor = earliestAnchorMonth !== null && earliestAnchorMonth < currentMonth ? earliestAnchorMonth : currentMonth;
  const webEnd = addMonthsToMonth(currentMonth, 11);
  const end = horizonEndMonth !== null && horizonEndMonth < webEnd ? horizonEndMonth : webEnd;
  return availableMonths(floor, end);
}

function earliestAnchorMonthFrom(data: SnapshotResponse): string | null {
  const value = data?.earliestAnchorMonth;
  if (value === null || value === undefined) return null;
  // A malformed value would move the floor silently; refuse it instead.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`home: earliestAnchorMonth is not a month: ${String(value)}`);
  }
  return value;
}

function monthFrom(data: SnapshotResponse, context: HomeContext, month: string): HomeMonth {
  const isPastMonth = month < context.currentMonth;
  return {
    month,
    isPastMonth,
    snapshot: snapshotFrom(data, month),
    plan: isPastMonth
      ? { kind: 'past' }
      : context.timeline
        ? planFrom(context.timeline, month, context.currentMonth)
        : { kind: 'noAnchor' },
  };
}

/** Paging: one month's snapshot over the context already loaded. */
export async function loadHomeMonth(get: Getter, context: HomeContext, month: string): Promise<HomeMonth> {
  return monthFrom(await get<SnapshotResponse>(homeSnapshotPath(month)), context, month);
}

/**
 * The opening load: the current month, and the context for paging. With
 * `month`, the same load lands on that month instead (a refresh while paged
 * away) — falling back to the current month if it is no longer reachable.
 */
export async function loadHome(
  get: Getter,
  at: () => Date = () => new Date(),
  month: string | null = null
): Promise<HomeLoad> {
  const [accounts, timezone] = await Promise.all([
    get<AccountsResponse>('/api/accounts'),
    get<TimezoneResponse>('/api/household/timezone'),
  ]);

  // The household's month, never the device's. Timezone failure propagates,
  // for the reason timelineLoader.ts gives.
  const currentMonth = businessMonth(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at());
  const chequing = accounts.accounts.find((account) => account.type === 'chequing');

  const [dashboard, timeline] = await Promise.all([
    get<SnapshotResponse>(homeSnapshotPath(currentMonth)),
    chequing ? get<HomeTimelineResponse>(homeTimelinePath(chequing.id)) : Promise.resolve(null),
  ]);

  const horizonEndMonth = timeline && timeline.ok ? timeline.horizonEndMonth ?? null : null;
  const context: HomeContext = {
    currentMonth,
    months: homeMonths(currentMonth, earliestAnchorMonthFrom(dashboard), horizonEndMonth),
    timeline,
  };

  if (month !== null && month !== currentMonth && context.months.includes(month)) {
    return { ...(await loadHomeMonth(get, context, month)), context };
  }
  return { ...monthFrom(dashboard, context, currentMonth), context };
}
