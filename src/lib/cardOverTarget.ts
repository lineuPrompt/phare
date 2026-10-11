import type { SupabaseClient } from '@supabase/supabase-js';
import { statementCycleWindow } from '@phare/core';
import {
  categoryActualsForCard,
  cycleState,
  envelopeRemaining,
  envelopeStatus,
  totalSpendForCard,
  type EnvTx,
} from './envelopeHelpers';
import { fetchCardPlanForMonth } from './cardPlanServer';
import { addMonthsToMonth } from './goalHelpers';
import { categoryDisplayName } from './categoryTranslations';
import { computeOverTargetCategories, type OverTargetCategory } from './coachingHelpers';

// ---------------------------------------------------------------------------
// ONE CARD, ONE CYCLE, AS THE CARDS PAGE SEES IT — for the monthly review.
//
// Every figure here comes from the helpers the Cards page itself uses, and
// from nothing else:
//   cycle dates   statementCycleWindow
//   open/closed   cycleState
//   goal, plan    fetchCardPlanForMonth (planForMonth: a closed cycle's own
//                 plan only; an open one carried forward)
//   spent         totalSpendForCard — what GET /api/cards/overview returns
//   per category  categoryActualsForCard
//   over          envelopeStatus 'over', and envelopeRemaining for the amount
//
// WHICH CYCLE (2026-10-10). Each card's cycle labelled with the REVIEWED
// month: the one that closes in it, the cycle the Cards page shows under that
// month. This used to be the cycle containing TODAY, which on the
// 1st-of-month cron run is a few days old, so a month's letter never saw that
// month's overspends.
//
// OPEN CYCLES. A manual refresh reviews the current month, whose cycles are
// usually still open. `open` travels with every figure so the letter can say
// a card is running ahead of its goal so far, never that it went over.
//
// A failed plan read throws: "no targets" must never stand in for "could not
// read the plan". `history` must cover the cycle before `cycleMonth` too.
// ---------------------------------------------------------------------------

export type CardCategoryFigure = {
  categoryId: string;
  name: string;
  nameFr: string | null;
  plan: number;
  actual: number;
  /** The same category's actual in the previous cycle. */
  previousActual: number;
};

export type CardCycleFacts = {
  cardId: string;
  cardName: string;
  cycleMonth: string;
  cycleStart: string;
  cycleEnd: string;
  open: boolean;
  /** null: no goal for this cycle. Never 0 standing in for "none". */
  goal: number | null;
  spent: number;
  previousCycleSpent: number;
  /** The cycle's planned categories, each with its actual. */
  categories: CardCategoryFigure[];
};

export async function loadCardCycleFacts(
  supabase: SupabaseClient,
  householdId: string,
  cards: { id: string; name?: string | null; statement_close_day?: number | null }[],
  history: EnvTx[],
  cycleMonth: string,
  today: string
): Promise<CardCycleFacts[]> {
  const previousMonth = addMonthsToMonth(cycleMonth, -1);
  const facts: CardCycleFacts[] = [];
  for (const card of cards) {
    const closeDay = card.statement_close_day ?? null;
    const closed = cycleState(cycleMonth, closeDay, today) === 'closed';
    const { goal, items } = await fetchCardPlanForMonth(supabase, householdId, card.id, cycleMonth, closed);
    const window = statementCycleWindow(cycleMonth, closeDay);

    const actuals = categoryActualsForCard(history, card.id, cycleMonth, closeDay);
    const previousActuals = categoryActualsForCard(history, card.id, previousMonth, closeDay);

    facts.push({
      cardId: card.id,
      cardName: card.name ?? '',
      cycleMonth,
      cycleStart: window.start,
      cycleEnd: window.end,
      open: !closed,
      goal,
      spent: totalSpendForCard(history, card.id, cycleMonth, closeDay),
      previousCycleSpent: totalSpendForCard(history, card.id, previousMonth, closeDay),
      categories: items.map((item) => ({
        categoryId: item.categoryId,
        name: item.categories?.name ?? '?',
        nameFr: item.categories?.name_fr ?? null,
        plan: item.monthlyAmount,
        actual: actuals.get(item.categoryId) ?? 0,
        previousActual: previousActuals.get(item.categoryId) ?? 0,
      })),
    });
  }
  return facts;
}

/** Every category over its plan, across the cards — the coaching layer's candidates. */
export function overTargetFromCardFacts(facts: CardCycleFacts[]): OverTargetCategory[] {
  return computeOverTargetCategories(
    facts.flatMap((card) =>
      card.categories.map((c) => ({ categoryName: c.name, target: c.plan, actual: c.actual, open: card.open }))
    )
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** How far past an amount a spend is, by the Cards page's own rule; null when it is not over. */
function overBy(plan: number | null, actual: number): number | null {
  if (plan === null || envelopeStatus(plan, actual) !== 'over') return null;
  return round2(-envelopeRemaining(plan, actual));
}

export type CardLetterFacts = {
  name: string;
  cycleStart: string;
  cycleEnd: string;
  /** True: the cycle has not closed. Nothing on it is "over" yet, only running ahead so far. */
  open: boolean;
  goal: number | null;
  spent: number;
  /** Present only when spent is past the goal. */
  overGoalBy?: number;
  previousCycleSpent: number;
  spentChange: number;
  /** Up to three categories over their own plan, largest first. */
  topOverspends: {
    category: string;
    plan: number;
    actual: number;
    over: number;
    previousActual: number;
    change: number;
  }[];
};

/** One card's cycle as the letter receives it. Names in the letter's language. */
export function cardLetterFacts(card: CardCycleFacts, locale: 'en' | 'fr'): CardLetterFacts {
  const over = overBy(card.goal, card.spent);
  const topOverspends = card.categories
    .map((c) => ({ c, over: overBy(c.plan, c.actual) }))
    .filter((x): x is { c: CardCategoryFigure; over: number } => x.over !== null)
    .sort((a, b) => b.over - a.over)
    .slice(0, 3)
    .map(({ c, over: amount }) => ({
      // The Cards page's own display name (name_fr, or the seed translation).
      category: categoryDisplayName({ name: c.name, name_fr: c.nameFr }, locale),
      plan: c.plan,
      actual: c.actual,
      over: amount,
      previousActual: c.previousActual,
      change: round2(c.actual - c.previousActual),
    }));
  return {
    name: card.cardName,
    cycleStart: card.cycleStart,
    cycleEnd: card.cycleEnd,
    open: card.open,
    goal: card.goal,
    spent: card.spent,
    ...(over === null ? {} : { overGoalBy: over }),
    previousCycleSpent: card.previousCycleSpent,
    spentChange: round2(card.spent - card.previousCycleSpent),
    topOverspends,
  };
}

/**
 * The over-target check on its own, for callers that need only that. Same
 * facts, same derivation as the letter's cards.
 */
export async function overTargetCategoriesForCycle(
  supabase: SupabaseClient,
  householdId: string,
  cards: { id: string; name?: string | null; statement_close_day?: number | null }[],
  history: EnvTx[],
  cycleMonth: string,
  today: string
): Promise<OverTargetCategory[]> {
  return overTargetFromCardFacts(await loadCardCycleFacts(supabase, householdId, cards, history, cycleMonth, today));
}
