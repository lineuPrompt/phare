import type { SupabaseClient } from '@supabase/supabase-js';
import { cycleMonthContaining } from '@phare/core';
import { categoryActualsForCard, cycleState, type EnvTx } from './envelopeHelpers';
import { fetchCardPlanForMonth } from './cardPlanServer';
import { computeOverTargetCategories, type OverTargetCategory } from './coachingHelpers';

/**
 * The monthly review's over-target check: every card category whose live
 * cycle spend is over its budget, judged against THE plan the household sees
 * on the Cards page for that cycle — fetchCardPlanForMonth, the one read rule.
 *
 * Before 2026-09-29 this read the live cycle month's own category rows only,
 * so a live cycle with no plan of its own (carried forward on the Cards page)
 * had no targets and the review reported nothing over target, however far
 * over the carried plan the spending was.
 *
 * Per card, since close days differ and so do live cycles
 * (cycleMonthContaining — the cycle whose window contains today). `history`
 * must cover each card's live cycle window.
 *
 * Code only. The review is given at most one of these, chosen by
 * selectTopOverTargetCategory; the AI never sees the list or chooses.
 * A failed plan read throws: "no targets" must never stand in for "could not
 * read the plan".
 */
export async function overTargetCategoriesForLiveCycles(
  supabase: SupabaseClient,
  householdId: string,
  cards: { id: string; statement_close_day?: number | null }[],
  history: EnvTx[],
  today: string
): Promise<OverTargetCategory[]> {
  const figures: { categoryName: string; target: number; actual: number }[] = [];
  for (const card of cards) {
    const closeDay = card.statement_close_day ?? null;
    const liveCycleMonth = cycleMonthContaining(today, closeDay);
    const closed = cycleState(liveCycleMonth, closeDay, today) === 'closed';
    const { items } = await fetchCardPlanForMonth(supabase, householdId, card.id, liveCycleMonth, closed);

    const actuals = categoryActualsForCard(history, card.id, liveCycleMonth, closeDay);
    for (const item of items) {
      figures.push({
        categoryName: item.categories?.name ?? '?',
        target: item.monthlyAmount,
        actual: actuals.get(item.categoryId) ?? 0,
      });
    }
  }
  return computeOverTargetCategories(figures);
}
