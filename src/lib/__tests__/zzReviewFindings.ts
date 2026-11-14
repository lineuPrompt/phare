// SCRATCH for handoff 4's dry run — the proposed src/lib/reviewFindings.ts.
// Deleted after the dry run. Pure: every input is the plan chain the Plan
// card receives (GET /api/timeline?includePlan=1) and the letter's own facts.
import type { CardStatementHistory, PlanChainMonthPayload, PlanMonthWhy } from '@/lib/planChainHelpers';

type Locale = 'en' | 'fr';
const cents = (n: number) => Math.round(n * 100);
const monthName = (m: string, locale: Locale) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' });

export type Severity = 'act' | 'watch';
export type PlanPoint = { month: string; endBalance: number; why: PlanMonthWhy | null };

export type Finding =
  | {
      type: 'planBelowZero'; severity: Severity; keyFigure: number;
      firstBelowZero: PlanPoint;
      lowest?: PlanPoint; // omitted when it is the same month
      belowZeroMonths: string[]; // every visible month that ends below zero, in order
      structural: boolean; // the lowest month's reason is the card budgets
      reasonSince: string; // first month of the run, ending at the lowest, with the lowest's reason
      fallingSince?: string; // first month of the run of falling month-ends ending at the lowest
    }
  | {
      type: 'cardBudgetBelowStatements'; severity: Severity; keyFigure: number;
      cards: { card: string; budget: number; average: number; count: number; statementsAboveBudget: number; lowestStatement: number; highestStatement: number }[];
    }
  | {
      type: 'lastMonthOverspends'; severity: Severity; keyFigure: number;
      cards: { card: string; goal: number; spent: number; overGoalBy: number }[];
    }
  | {
      type: 'goalBehind'; severity: Severity; keyFigure: number;
      goals: { name: string; targetDate: string | null; remaining: number; reachedAtActualContribution: string }[];
    };

export type PlanAhead = {
  asOf: string;
  horizonMonths: number;
  path: { month: string; endBalance: number }[];
  statementCheck: { card: string; budget: number | null; count: number; average: number; statements: { cycle: string; total: number }[] }[];
};

/** The budget the plan carries forward: the card's budget in the last visible month. */
function carriedBudget(months: PlanChainMonthPayload[], cardId: string): number | null {
  const last = months[months.length - 1];
  return last?.cardCost.find((c) => c.cardId === cardId)?.budget ?? null;
}

export function buildPlanAhead(plan: { months: PlanChainMonthPayload[]; horizonMonths: number; statementHistory: CardStatementHistory[] }, today: string, locale: Locale): PlanAhead {
  return {
    asOf: today,
    horizonMonths: plan.horizonMonths,
    path: plan.months.map((m) => ({ month: monthName(m.month, locale), endBalance: m.balance })),
    statementCheck: plan.statementHistory.map((h) => ({
      card: h.cardName,
      budget: carriedBudget(plan.months, h.cardId),
      count: h.count,
      average: h.average,
      statements: h.statements.map((s) => ({ cycle: monthName(s.cycleMonth, locale), total: s.total })),
    })),
  };
}

export function buildFindings(params: {
  plan: { months: PlanChainMonthPayload[]; statementHistory: CardStatementHistory[] };
  letterCards: { name: string; open: boolean; goal: number | null; spent: number; overGoalBy?: number }[];
  goals: { name: string; targetDate: string | null; remaining: number; onTrackAtActualContribution?: boolean; reachedAtActualContribution?: string }[];
  locale: Locale;
}): Finding[] {
  const { plan, letterCards, goals, locale } = params;
  const months = plan.months;
  const out: Finding[] = [];
  const point = (i: number): PlanPoint => ({ month: monthName(months[i].month, locale), endBalance: months[i].balance, why: months[i].why });

  // 1. The plan below zero within the visible horizon.
  const firstIdx = months.findIndex((m) => cents(m.balance) < 0);
  if (firstIdx >= 0) {
    let low = 0;
    for (let i = 1; i < months.length; i++) if (cents(months[i].balance) < cents(months[low].balance)) low = i; // first on a tie, as explainPlanPath
    const lowKind = months[low].why?.kind ?? null;
    let since = low;
    while (since > 0 && lowKind !== null && months[since - 1].why?.kind === lowKind) since--;
    let falling = low;
    while (falling > 0 && cents(months[falling].balance) < cents(months[falling - 1].balance)) falling--;
    const structural = lowKind === 'cardsOverLeft';
    out.push({
      type: 'planBelowZero',
      // act: the shortfall recurs, or it is within three months; watch: a timing dip further out.
      severity: structural || firstIdx < 3 ? 'act' : 'watch',
      keyFigure: months[low].balance,
      firstBelowZero: point(firstIdx),
      ...(low === firstIdx ? {} : { lowest: point(low) }),
      belowZeroMonths: months.filter((m) => cents(m.balance) < 0).map((m) => monthName(m.month, locale)),
      structural,
      reasonSince: monthName(months[since].month, locale),
      ...(falling < low ? { fallingSince: monthName(months[falling + 1].month, locale) } : {}),
    });
  }

  // 2. A card's carried budget below its real closed statements: the average
  //    above the budget AND more than half of the statements above it.
  const budgetCards = plan.statementHistory
    .map((h) => {
      const budget = carriedBudget(months, h.cardId);
      if (budget === null) return null;
      const above = h.statements.filter((s) => cents(s.total) > cents(budget)).length;
      if (!(cents(h.average) > cents(budget) && above * 2 > h.count)) return null;
      const totals = h.statements.map((s) => s.total);
      return { card: h.cardName, budget, average: h.average, count: h.count, statementsAboveBudget: above,
        lowestStatement: Math.min(...totals), highestStatement: Math.max(...totals), gapC: cents(h.average) - cents(budget) };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.gapC - a.gapC || a.card.localeCompare(b.card));
  if (budgetCards.length > 0) {
    out.push({
      type: 'cardBudgetBelowStatements',
      severity: firstIdx >= 0 ? 'act' : 'watch', // the plan already falls short on budgets below real spending
      keyFigure: budgetCards[0].average,
      cards: budgetCards.slice(0, 2).map(({ gapC: _g, ...c }) => c),
    });
  }

  // 3. The reviewed cycle's closed cards over their goal, minus cards finding 2 already names.
  const named = new Set(budgetCards.map((c) => c.card));
  const over = letterCards
    .filter((c) => !c.open && c.goal !== null && c.overGoalBy !== undefined && !named.has(c.name))
    .map((c) => ({ card: c.name, goal: c.goal as number, spent: c.spent, overGoalBy: c.overGoalBy as number }))
    .sort((a, b) => cents(b.overGoalBy) - cents(a.overGoalBy) || a.card.localeCompare(b.card));
  if (over.length > 0) out.push({ type: 'lastMonthOverspends', severity: 'watch', keyFigure: over[0].overGoalBy, cards: over.slice(0, 2) });

  // 4. A goal whose own transfers miss its date.
  const behind = goals
    .filter((g) => g.onTrackAtActualContribution === false && g.reachedAtActualContribution)
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || cents(b.remaining) - cents(a.remaining))
    .map((g) => ({ name: g.name, targetDate: g.targetDate, remaining: g.remaining, reachedAtActualContribution: g.reachedAtActualContribution as string }));
  if (behind.length > 0) out.push({ type: 'goalBehind', severity: 'watch', keyFigure: behind[0].remaining, goals: behind.slice(0, 2) });

  return out;
}

/** Every number a finding carries — the extra figures topRecommendation may quote. */
export function findingFigures(f: Finding | undefined): number[] {
  if (!f) return [];
  const nums: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') nums.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(f);
  return nums;
}
