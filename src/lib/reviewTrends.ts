// ---------------------------------------------------------------------------
// WHAT CHANGED, OVER REAL MONTHS (2026-11-03).
//
// The letter compared the reviewed month with the month before on two totals
// only, so with similar months it gave the same advice every time (Lineu,
// 2026-11-03: "it's always the same advice"). These are the facts it was
// missing, all computed here and only narrated by the letter:
//
//   categoryTrends          spending per category, month by month — card
//                           rows by statement cycle (categoryActualsForCard,
//                           the Cards page's own figure), chequing rows by
//                           calendar month; code picks what moved most
//   balanceProgress         a goal's, the reserve's or the debt's balance at
//                           each month's end (computeGoalBalance)
//   previousRecommendation  last month's "one thing", quoted, with its
//                           figures as numbers so the figure guard knows them
//
// Real months, never averages: a month with no spending at all (before the
// household started) is left out, never counted as $0. Rows dated after today
// are plan, not spending, and never counted.
// ---------------------------------------------------------------------------

import { categoryActualsForCard, signedAmount } from '@/lib/envelopeHelpers';
import { computeGoalBalance } from '@/lib/dashboardHelpers';
import { extractDollarFigures } from '@/lib/letterGuards';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export type NamedMonth = { month: string; name: string };

export type TrendTx = {
  account_id: string | null;
  amount: number | string;
  type: string;
  date: string;
  category_id: string | null;
  is_bridge?: boolean | null;
};

export type CategoryTrend = {
  name: string;
  amounts: { month: string; amount: number }[];
  thisMonth: number;
  lastMonth: number | null;
  /** thisMonth − lastMonth. Absent while the month is in progress. */
  changeVsLastMonth?: number;
  /** Higher (lower) than every earlier month shown; needs three months or more. */
  highestOfMonths?: true;
  lowestOfMonths?: true;
};

export type CategoryTrendFacts = {
  monthInProgress: boolean;
  months: NamedMonth[];
  categories: CategoryTrend[];
  biggestIncrease?: { name: string; change: number };
  biggestDecrease?: { name: string; change: number };
};

/**
 * Spending per category over `months` (oldest first, the reviewed month
 * last). Null when the reviewed month has no spending or there is no earlier
 * month to compare with.
 */
export function categoryTrends(input: {
  rows: TrendTx[];
  chequingIds: string[];
  cards: { id: string; closeDay: number | null }[];
  categoryNames: Map<string, string>;
  months: NamedMonth[];
  today: string;
  monthInProgress: boolean;
  limit?: number;
}): CategoryTrendFacts | null {
  const { chequingIds, cards, categoryNames, today, monthInProgress } = input;
  const limit = input.limit ?? 8;
  const rows = input.rows.filter((r) => r.date <= today && !r.is_bridge);
  const chequing = new Set(chequingIds);

  // month → category id → amount, and whether the month had any spending.
  const byMonth = input.months.map(({ month }) => {
    const amounts = new Map<string, number>();
    let hasSpending = false;
    const start = `${month}-01`;
    const end = lastDayOf(month);
    for (const r of rows) {
      if (r.account_id === null || !chequing.has(r.account_id) || r.type !== 'expense') continue;
      if (r.date < start || r.date > end) continue;
      hasSpending = true;
      if (r.category_id) amounts.set(r.category_id, r2((amounts.get(r.category_id) ?? 0) + Number(r.amount)));
    }
    for (const card of cards) {
      const cardRows = rows.filter((r) => r.account_id === card.id) as (TrendTx & { account_id: string })[];
      for (const [catId, amount] of categoryActualsForCard(cardRows, card.id, month, card.closeDay)) {
        amounts.set(catId, r2((amounts.get(catId) ?? 0) + amount));
      }
      if (!hasSpending) hasSpending = cardRows.some((r) => signedAmount(r) !== null && r.date.startsWith(month));
    }
    return { month, amounts, hasSpending };
  });

  const reviewed = byMonth[byMonth.length - 1];
  const real = byMonth.filter((m) => m.hasSpending);
  if (!reviewed?.hasSpending || real.length < 2) return null;
  const months = input.months.filter((m) => real.some((r) => r.month === m.month));
  const previous = real[real.length - 2];

  const ids = new Set(real.flatMap((m) => [...m.amounts.keys()]));
  const all: CategoryTrend[] = [];
  for (const id of ids) {
    const name = categoryNames.get(id);
    if (!name) continue;
    const amounts = real.map((m) => ({ month: m.month, amount: m.amounts.get(id) ?? 0 }));
    const thisMonth = reviewed.amounts.get(id) ?? 0;
    const lastMonth = previous.amounts.get(id) ?? 0;
    if (thisMonth === 0 && lastMonth === 0) continue;
    const earlier = amounts.slice(0, -1).map((a) => a.amount);
    all.push({
      name,
      amounts,
      thisMonth,
      lastMonth,
      ...(monthInProgress ? {} : { changeVsLastMonth: r2(thisMonth - lastMonth) }),
      ...(!monthInProgress && amounts.length >= 3 && earlier.every((a) => thisMonth > a) ? { highestOfMonths: true as const } : {}),
      ...(!monthInProgress && amounts.length >= 3 && earlier.every((a) => thisMonth < a) ? { lowestOfMonths: true as const } : {}),
    });
  }

  // A month in progress has no changeVsLastMonth, so no biggest either.
  let biggestIncrease: CategoryTrend | undefined;
  let biggestDecrease: CategoryTrend | undefined;
  for (const c of all) {
    const change = c.changeVsLastMonth ?? 0;
    if (change > 0 && change > (biggestIncrease?.changeVsLastMonth ?? 0)) biggestIncrease = c;
    if (change < 0 && change < (biggestDecrease?.changeVsLastMonth ?? 0)) biggestDecrease = c;
  }

  const shown = [...all]
    .sort((a, b) => Math.max(b.thisMonth, b.lastMonth ?? 0) - Math.max(a.thisMonth, a.lastMonth ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
  for (const c of [biggestIncrease, biggestDecrease]) if (c && !shown.includes(c)) shown.push(c);

  return {
    monthInProgress,
    months,
    categories: shown,
    ...(biggestIncrease ? { biggestIncrease: { name: biggestIncrease.name, change: biggestIncrease.changeVsLastMonth! } } : {}),
    ...(biggestDecrease ? { biggestDecrease: { name: biggestDecrease.name, change: biggestDecrease.changeVsLastMonth! } } : {}),
  };
}

export type BalanceProgress = {
  name: string;
  kind: 'goal' | 'reserve' | 'debt';
  balances: { month: string; balance: number }[];
  /** Last balance shown − first balance shown. */
  change: number;
};

/**
 * An account's balance at the end of each month (today, for a month still
 * running), from the month of its first row on. Null with fewer than two.
 */
export function balanceProgress(input: {
  rows: { amount: number | string; type: string; account_id: string | null; date?: string }[];
  accountId: string;
  name: string;
  kind: BalanceProgress['kind'];
  months: NamedMonth[];
  today: string;
}): BalanceProgress | null {
  const { rows, accountId, name, kind, today } = input;
  const dates = rows.filter((r) => r.account_id === accountId && r.date !== undefined).map((r) => r.date as string).sort();
  if (dates.length === 0) return null;
  const firstMonth = dates[0].slice(0, 7);
  const balances = input.months
    .filter(({ month }) => month >= firstMonth && `${month}-01` <= today)
    .map(({ month }) => {
      const end = lastDayOf(month);
      return { month, balance: computeGoalBalance(rows, accountId, end < today ? end : today) };
    });
  if (balances.length < 2) return null;
  return { name, kind, balances, change: r2(balances[balances.length - 1].balance - balances[0].balance) };
}

export type PreviousRecommendation = { month: string; text: string; figures: number[] };

/**
 * Last month's "one thing": the month-end letter's, else the latest refresh's.
 * Its dollar figures are listed as numbers: the figure guard reads numbers,
 * never the text of a string.
 */
export function previousRecommendation(
  rows: { generated_by: string | null; created_at: string; messages: unknown }[],
  monthName: string
): PreviousRecommendation | null {
  const ordered = [...rows].sort((a, b) =>
    (a.generated_by === 'cron' ? 0 : 1) - (b.generated_by === 'cron' ? 0 : 1) || b.created_at.localeCompare(a.created_at)
  );
  for (const row of ordered) {
    const messages = Array.isArray(row.messages) ? (row.messages as { type?: unknown; content?: unknown }[]) : [];
    const text = messages.find((m) => m?.type === 'top_recommendation')?.content;
    if (typeof text === 'string' && text.trim()) {
      return {
        month: monthName,
        text: text.trim(),
        figures: [...new Set(extractDollarFigures(text).map((f) => f.cents / 100))],
      };
    }
  }
  return null;
}
