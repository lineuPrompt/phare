import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { reconcileMonth, ReconcileTxRow, ReconcileAccountRow } from '@/lib/reconcileHelpers';

/**
 * GET /api/reconcile?month=YYYY-MM
 *
 * Audit endpoint — returns every money number for the month traced to the
 * ledger, using two independent derivation paths so a bug in either path
 * surfaces as a non-zero netDifference.
 *
 * Fetches ALL accounts (not just chequing) so card and goal account rows
 * appear in the per-account audit table.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'Invalid month (expected YYYY-MM)' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const [y, m] = monthParam.split('-').map(Number);
    const monthStart = `${monthParam}-01`;
    const monthEnd = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // Fetch accounts and all transactions for the month in parallel.
    // We deliberately fetch ALL account types (chequing, credit_card, savings,
    // tfsa, rrsp) so the per-account audit table is complete.
    const [acctResult, txResult] = await Promise.all([
      supabase
        .from('accounts')
        .select('id, name, type')
        .eq('household_id', householdId)
        .order('type', { ascending: true }),

      supabase
        .from('transactions')
        .select('id, date, description, amount, type, account_id, is_bridge')
        .eq('household_id', householdId)
        .gte('date', monthStart)
        .lt('date', monthEnd)
        .order('date', { ascending: true }),
    ]);

    const accounts = (acctResult.data ?? []) as ReconcileAccountRow[];
    const transactions = (txResult.data ?? []) as ReconcileTxRow[];

    const result = reconcileMonth(transactions, accounts);

    return NextResponse.json({ month: monthParam, ...result });
  } catch (error) {
    console.error('Reconcile GET error:', error);
    return NextResponse.json({ error: 'Failed to load reconciliation' }, { status: 500 });
  }
}
