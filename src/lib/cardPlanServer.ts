import type { createClient } from './supabase-server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The card goal that applies to one cycle month.
 *
 *   closed cycle  → that month's OWN monthly_goals row, or null. Snapshot-only:
 *                   a past month shows what was planned FOR it, never a goal
 *                   carried in from an earlier month.
 *   open / future → the nearest row at or before the month (carry-forward),
 *                   unchanged from before 2026-09-11.
 *
 * GET /api/card-envelope (the decision view) and GET /api/cards/overview (the
 * cross-card strip) render on the same screen for the same picked month, so
 * they share this one query rather than each hand-rolling the branch.
 *
 * Throws on a query error rather than returning null: null means "no goal was
 * saved", and a database failure must not be displayed as that.
 */
export async function fetchCardGoalForMonth(
  supabase: Supabase,
  householdId: string,
  cardId: string,
  month: string,
  closed: boolean
): Promise<number | null> {
  const monthStart = `${month}-01`;
  const base = supabase
    .from('monthly_goals')
    .select('card_goal')
    .eq('household_id', householdId)
    .eq('account_id', cardId);

  const { data, error } = closed
    ? await base.eq('month', monthStart).maybeSingle()
    : await base.lte('month', monthStart).order('month', { ascending: false }).limit(1).maybeSingle();

  if (error) throw new Error(`monthly_goals read failed: ${error.message}`);
  return data ? Number(data.card_goal) : null;
}
