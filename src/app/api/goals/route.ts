import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { GOAL_ACCOUNT_TYPES, computeGoalBalance } from '@/lib/dashboardHelpers';
import { computeDebtPayoff } from '@/lib/goalHelpers';
import { computeContributionDrift } from '@/lib/contributionDrift';
import { businessToday, firstOfNextMonth } from '@phare/core';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id;

    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type, goal_target, goal_target_date, is_sinking_fund')
      .eq('household_id', householdId)
      .in('type', [...GOAL_ACCOUNT_TYPES])
      .order('name', { ascending: true });

    // A sinking fund is not a goal (it cycles — fills and drains — a goal
    // only receives) and is surfaced through the dashboard's sinkingFunds
    // section instead, so it must never also appear here (Build 4 Part 2,
    // 2026-07-21).
    const goalAccounts = (accounts ?? []).filter((a) => !a.is_sinking_fund);
    const goalIds = goalAccounts.map((a) => a.id);

    // Fetch FULL (all-time) transaction history for goal accounts.
    // CONTRACT: computeGoalBalance requires full history — never a month-scoped slice.
    type TxResult = { id: string; amount: number | string; type: string; account_id: string | null; date: string; description: string | null; is_opening_balance: boolean | null };
    let txData: TxResult[] = [];
    if (goalIds.length > 0) {
      const { data: txResult } = await supabase
        .from('transactions')
        .select('id, amount, type, account_id, date, description, is_opening_balance')
        .eq('household_id', householdId)
        .in('account_id', goalIds)
        .order('date', { ascending: false });
      txData = (txResult ?? []) as TxResult[];
    }

    // Each goal's active recurring transfer rule, if any (Build 4 Phase 2) —
    // "$500/mo · next: Aug 1" on the goal card, and the source for the
    // optional contribution projection. A goal can have at most one active
    // recurring transfer rule at a time in this UI (created from either the
    // Goals or Recurring page).
    type RecurringRuleRow = {
      id: string; amount: number | string; cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
      anchor_date: string | null; second_day: number | null; destination_account_id: string | null; effective_from: string | null;
    };
    let recurringByGoal = new Map<string, RecurringRuleRow>();
    if (goalIds.length > 0) {
      const { data: ruleRows } = await supabase
        .from('recurring_items')
        .select('id, amount, cadence, anchor_date, second_day, destination_account_id, effective_from')
        .eq('household_id', householdId)
        .eq('type', 'transfer')
        .eq('active', true)
        .in('destination_account_id', goalIds);
      recurringByGoal = new Map(
        ((ruleRows ?? []) as RecurringRuleRow[]).map((r) => [r.destination_account_id as string, r])
      );
    }

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const today = businessToday(timezone);

    // Detached occurrences (edited or deleted singles) dated on/after the
    // boundary a schedule edit would use — same figure the Reserve Fund has
    // always had (api/sinking-funds/route.ts). The goal card's contribution
    // editor needs it to warn BEFORE a schedule move strands them; without
    // it that editor would move a schedule blind. Fetched for every goal's
    // rule in one query and counted per rule, rather than a count query per
    // goal.
    const boundary = firstOfNextMonth(today);
    const ruleIds = [...recurringByGoal.values()].map((r) => r.id);
    const tombstonesByRule = new Map<string, number>();
    if (ruleIds.length > 0) {
      const { data: tombRows } = await supabase
        .from('recurring_skipped_dates')
        .select('recurring_item_id')
        .eq('household_id', householdId)
        .in('recurring_item_id', ruleIds)
        .gte('date', boundary);
      for (const row of (tombRows ?? []) as { recurring_item_id: string }[]) {
        tombstonesByRule.set(row.recurring_item_id, (tombstonesByRule.get(row.recurring_item_id) ?? 0) + 1);
      }
    }

    const goals = goalAccounts.map((a) => {
      // Goal-side transfer rows: account_id = this goal, type = 'transfer'.
      // Split past (history — already happened) from future (Upcoming —
      // materialized by Phase 2's recurring transfers ahead of time, but
      // not real yet) rather than mixing them in one list, per the same
      // "future is future" rule the balance cutoff below enforces.
      const goalTransfers = txData.filter((tx) => tx.account_id === a.id && tx.type === 'transfer');
      const toLine = (tx: TxResult) => ({
        id:          tx.id,
        date:        tx.date,
        description: tx.description,
        amount:      Number(tx.amount),
        // Lets the history list label this row from i18n and hide the
        // edit/delete affordances — it is changed through the goal's own
        // form, and PATCH/DELETE /api/transfers/[id] refuse it outright.
        isOpeningBalance: tx.is_opening_balance === true,
      });
      const transfers = goalTransfers.filter((tx) => tx.date <= today).map(toLine);
      const upcomingTransfers = goalTransfers
        .filter((tx) => tx.date > today)
        .map(toLine)
        .sort((x, y) => x.date.localeCompare(y.date));

      const rule = recurringByGoal.get(a.id) ?? null;
      const isDebt = a.type === 'debt';
      const balance = computeGoalBalance(txData, a.id, today);
      // 0 is a legitimate target (always true for debt) — must not collapse to null.
      const goalTarget = a.goal_target != null ? Number(a.goal_target) : null;
      const goalTargetDate = a.goal_target_date ?? null;

      // Debt payoff, computed directly from this explicitly-typed account —
      // never the isDebtGoalName keyword heuristic, which only applies to
      // typeless template-parsed rows (see api/plan/route.ts). Same pure
      // requiredMonthlyContribution every other goal uses; target and saved
      // are simply in the negative domain here. Uses the today-cutoff
      // balance — "paid off" must mean genuinely paid off as of today, not
      // after future payments that haven't happened yet.
      const debtPayoff = isDebt
        ? computeDebtPayoff({ name: a.name, targetAmount: goalTarget ?? 0, savedSoFar: balance, targetDate: goalTargetDate }, today)
        : null;

      return {
        id:             a.id,
        name:           a.name,
        type:           a.type,
        isDebt,
        balance,
        goalTarget,
        goalTargetDate,
        transfers,
        upcomingTransfers,
        recurringContribution: rule ? {
          recurringItemId: rule.id,
          amount: Number(rule.amount),
          cadence: rule.cadence,
          anchorDate: rule.anchor_date,
          secondDay: rule.second_day,
          tombstonesAfterBoundary: tombstonesByRule.get(rule.id) ?? 0,
        } : null,
        // Do the upcoming rows still say what the rule says? They can stop
        // agreeing without any join surviving to prove it — editing a single
        // occurrence nulls its recurring_item_id (see lib/contributionDrift.ts)
        // — so this compares the amounts actually listed, not the FK. Drives
        // the on-card notice AND suppresses the projection, which is computed
        // from the rule amount and is therefore wrong whenever this is set.
        contributionDrift: computeContributionDrift(
          upcomingTransfers,
          rule ? Number(rule.amount) : null,
          rule?.effective_from ?? null
        ),
        debtPayoff,
      };
    });

    return NextResponse.json({ goals });
  } catch (error) {
    console.error('Goals GET error:', error);
    return NextResponse.json({ error: 'Failed to load goals' }, { status: 500 });
  }
}
