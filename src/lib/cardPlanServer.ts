import type { createClient } from './supabase-server';
import { planForMonth } from './envelopeHelpers';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CardPlanItem = {
  categoryId: string;
  monthlyAmount: number;
  categories: { name: string; name_fr: string | null } | null;
};

export type CardPlan = { goal: number | null; items: CardPlanItem[] };

/**
 * The card plan (goal + category budgets) that applies to one cycle month,
 * resolved by envelopeHelpers.planForMonth — the one read rule:
 *
 *   closed cycle  → that month's OWN snapshot only, or none.
 *   open / future → carried forward from the nearest saved month at or
 *                   before it.
 *
 * Every server surface that shows or judges a card's plan for a month reads
 * it here: GET /api/card-envelope (the decision view), GET /api/cards/overview
 * (the cross-card strip, and mobile's card room) and the monthly review's
 * over-target check. The grid applies the same planForMonth to its own
 * all-months read. Before 2026-09-29 the decision view's category rows and
 * the review read the exact month only, so an open month with no plan of its
 * own showed a carried goal over an empty category list.
 *
 * Throws on a query error rather than returning an empty plan: an empty plan
 * means "nothing was saved", and a database failure must not be displayed
 * (or judged by the review) as that.
 */
export async function fetchCardPlanForMonth(
  supabase: Supabase,
  householdId: string,
  cardId: string,
  month: string,
  closed: boolean
): Promise<CardPlan> {
  const monthStart = `${month}-01`;

  const goalsQuery = supabase
    .from('monthly_goals')
    .select('month, card_goal')
    .eq('household_id', householdId)
    .eq('account_id', cardId);
  const itemsQuery = supabase
    .from('card_envelope_items')
    .select('month, category_id, monthly_amount, categories(name, name_fr)')
    .eq('household_id', householdId)
    .eq('account_id', cardId);

  const [{ data: goalRows, error: goalErr }, { data: itemRows, error: itemErr }] = await Promise.all([
    closed ? goalsQuery.eq('month', monthStart) : goalsQuery.lte('month', monthStart),
    closed ? itemsQuery.eq('month', monthStart) : itemsQuery.lte('month', monthStart),
  ]);
  if (goalErr) throw new Error(`monthly_goals read failed: ${goalErr.message}`);
  if (itemErr) throw new Error(`card_envelope_items read failed: ${itemErr.message}`);

  const goalsByMonth = new Map<string, number>(
    (goalRows ?? []).map((g) => [(g.month as string).slice(0, 7), Number(g.card_goal)])
  );
  const itemsByMonth = new Map<string, CardPlanItem[]>();
  for (const row of itemRows ?? []) {
    const m = (row.month as string).slice(0, 7);
    const list = itemsByMonth.get(m) ?? [];
    list.push({
      categoryId: row.category_id as string,
      monthlyAmount: Number(row.monthly_amount),
      categories: row.categories as unknown as CardPlanItem['categories'],
    });
    itemsByMonth.set(m, list);
  }

  return planForMonth(goalsByMonth, itemsByMonth, month, closed);
}
