import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeGoalBalance } from '@/lib/dashboardHelpers';
import { businessToday, nextOccurrence } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

/**
 * GET /api/sinking-funds
 *
 * The management-page read path (Build 4 Part A lifecycle, 2026-07-21) —
 * everything needed to view and act on the ONE shared buffer: real balance,
 * the recurring contribution (amount + next date, so an edit can be driven
 * straight through the existing PATCH /api/recurring/[id] split machinery),
 * contribution history (past) vs upcoming (future, materialized ahead of
 * time), and bills already paid from it. Per-fund rows stay informational —
 * see dashboard/route.ts's sinkingFunds shape, same convention here.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id;

    const { data: fundRows } = await supabase
      .from('sinking_funds')
      .select('id, name, annual_amount, monthly_provision, due_month, linked_account_id, active')
      .eq('household_id', householdId);
    const funds = (fundRows ?? []).map((sf) => ({
      id: sf.id,
      name: sf.name,
      annual_amount: Number(sf.annual_amount),
      monthly_provision: Number(sf.monthly_provision),
      due_month: sf.due_month,
      active: sf.active !== false,
    }));

    const linkedAccountId = (fundRows ?? []).find((sf) => sf.linked_account_id)?.linked_account_id ?? null;
    // Contribution follows the sum of ACTIVE allocations only — excluded
    // lines are display-only and never count toward what the buffer funds.
    const totalMonthlyProvision = Math.round(
      (fundRows ?? [])
        .filter((sf) => sf.active !== false)
        .reduce((sum, sf) => sum + Number(sf.monthly_provision ?? 0), 0) * 100
    ) / 100;

    if (!linkedAccountId) {
      return NextResponse.json({
        funds,
        buffer: {
          linkedAccountId: null,
          balance: 0,
          fundedAlready: false,
          totalMonthlyProvision,
          contributionAmount: null,
          cadence: null,
          secondDay: null,
          recurringItemId: null,
          nextContributionDate: null,
          contributions: [],
          upcomingContributions: [],
          billsPaid: [],
        },
      });
    }

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const today = businessToday(timezone);

    const { data: txRows } = await supabase
      .from('transactions')
      .select('id, amount, type, account_id, date, description')
      .eq('household_id', householdId)
      .eq('account_id', linkedAccountId)
      .order('date', { ascending: false });
    const allTx = (txRows ?? []) as {
      id: string; amount: number | string; type: string; account_id: string | null;
      date: string; description: string | null;
    }[];

    const balance = computeGoalBalance(allTx, linkedAccountId, today);

    const toLine = (tx: typeof allTx[number]) => ({
      id: tx.id, date: tx.date, description: tx.description, amount: Number(tx.amount),
    });
    const transferRows = allTx.filter((t) => t.type === 'transfer');
    const contributions = transferRows.filter((t) => t.date <= today).map(toLine);
    const upcomingContributions = transferRows.filter((t) => t.date > today).map(toLine)
      .sort((a, b) => a.date.localeCompare(b.date));
    const billsPaid = allTx.filter((t) => t.type === 'expense' && t.date <= today).map(toLine);

    const { data: recurringRow } = await supabase
      .from('recurring_items')
      .select('id, amount, cadence, anchor_date, second_day')
      .eq('household_id', householdId)
      .eq('destination_account_id', linkedAccountId)
      .eq('type', 'transfer')
      .eq('active', true)
      .maybeSingle();

    const recurringItemId = recurringRow?.id ?? null;
    const contributionAmount = recurringRow ? Number(recurringRow.amount) : null;
    const cadence = recurringRow?.cadence ?? null;
    const secondDay = recurringRow?.second_day ?? null;
    const nextContributionDate = recurringRow
      ? nextOccurrence(
          { cadence: recurringRow.cadence, anchorDate: recurringRow.anchor_date, secondDay: recurringRow.second_day },
          today
        )
      : null;

    return NextResponse.json({
      funds,
      buffer: {
        linkedAccountId,
        balance,
        fundedAlready: balance > 0,
        totalMonthlyProvision,
        contributionAmount,
        cadence,
        secondDay,
        recurringItemId,
        nextContributionDate,
        contributions,
        upcomingContributions,
        billsPaid,
      },
    });
  } catch (error) {
    console.error('Sinking funds GET error:', error);
    return NextResponse.json({ error: 'Failed to load sinking funds' }, { status: 500 });
  }
}
