/**
 * Shared recurring-transfer materialization: one create_transfer RPC call
 * per occurrence date, the same atomic pair-insert one-off transfers use.
 * Each call is independently atomic (both sides or neither); a mid-loop
 * failure stops materialization but never leaves a half-written pair.
 *
 * Extracted from recurring/route.ts POST (Build 4 Phase 2) so the
 * "start funding this sinking fund" flow (Build 4 Part 2, 2026-07-21) can
 * drive the exact same mechanism instead of a second copy of this loop.
 */

type SupabaseLike = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }> };

export type MaterializeTransferParams = {
  householdId: string;
  memberId: string;
  chequingId: string;
  destinationId: string;
  amount: number;
  description: string;
  recurringItemId: string;
  dates: string[];
};

export type MaterializeTransferResult = {
  materialized: number;
  error: string | null;
};

export async function materializeTransferOccurrences(
  supabase: SupabaseLike,
  params: MaterializeTransferParams
): Promise<MaterializeTransferResult> {
  let materialized = 0;
  for (const date of params.dates) {
    const { error } = await supabase.rpc('create_transfer', {
      p_household_id: params.householdId,
      p_member_id: params.memberId,
      p_chequing_id: params.chequingId,
      p_goal_id: params.destinationId,
      p_amount: params.amount,
      p_date: date,
      p_description: params.description,
      p_recurring_item_id: params.recurringItemId,
    });
    if (error) {
      return { materialized, error: error.message || 'Materialization failed partway through' };
    }
    materialized += 1;
  }
  return { materialized, error: null };
}
