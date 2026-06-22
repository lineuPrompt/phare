import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { GOAL_ACCOUNT_TYPES, computeGoalBalance } from '@/lib/dashboardHelpers';

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
      .select('id, name, type, goal_target, goal_target_date')
      .eq('household_id', householdId)
      .in('type', [...GOAL_ACCOUNT_TYPES])
      .order('name', { ascending: true });

    const goalAccounts = accounts ?? [];
    const goalIds = goalAccounts.map((a) => a.id);

    // Fetch FULL (all-time) transaction history for goal accounts.
    // CONTRACT: computeGoalBalance requires full history — never a month-scoped slice.
    type TxResult = { id: string; amount: number | string; type: string; account_id: string | null; date: string; description: string | null };
    let txData: TxResult[] = [];
    if (goalIds.length > 0) {
      const { data: txResult } = await supabase
        .from('transactions')
        .select('id, amount, type, account_id, date, description')
        .eq('household_id', householdId)
        .in('account_id', goalIds)
        .order('date', { ascending: false });
      txData = (txResult ?? []) as TxResult[];
    }

    const goals = goalAccounts.map((a) => {
      // Goal-side transfer rows: account_id = this goal, type = 'transfer'
      const transfers = txData
        .filter((tx) => tx.account_id === a.id && tx.type === 'transfer')
        .map((tx) => ({
          id:          tx.id,
          date:        tx.date,
          description: tx.description,
          amount:      Number(tx.amount),
        }));

      return {
        id:             a.id,
        name:           a.name,
        type:           a.type,
        balance:        computeGoalBalance(txData, a.id),
        goalTarget:     a.goal_target ? Number(a.goal_target) : null,
        goalTargetDate: a.goal_target_date ?? null,
        transfers,
      };
    });

    return NextResponse.json({ goals });
  } catch (error) {
    console.error('Goals GET error:', error);
    return NextResponse.json({ error: 'Failed to load goals' }, { status: 500 });
  }
}
