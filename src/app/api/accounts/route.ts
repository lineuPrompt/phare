import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { logEvent, isFirstEvent } from '@/lib/eventLogger';
import { businessToday } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// GET: list household accounts (chequing first, then cards)
export async function GET() {
  try {
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // sort_order first (explicit, template/entry order — see
    // 20260716000000 migration), then created_at and id as tiebreakers for
    // legacy rows that predate sort_order (all default to 0 and tie there).
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type, statement_close_day, payment_day, goal_target, goal_target_date')
      .eq('household_id', householdId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    return NextResponse.json({ accounts: accounts ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }
}

const VALID_TYPES = ['chequing', 'credit_card', 'line_of_credit', ...GOAL_ACCOUNT_TYPES];

// POST: create an account (credit card, line of credit, or goal account)
export async function POST(request: Request) {
  try {
    const { name, type, statementCloseDay, paymentDay, goalTarget, goalTargetDate, openingBalance } = await request.json();
    if (!name?.trim() || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const householdId = user
      ? (await supabase.from('users').select('household_id').eq('id', user.id).single()).data?.household_id ?? null
      : null;
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // New accounts append after everything the household already has —
    // never sort_order 0, which would jump a manually-added card ahead of
    // every template-imported one.
    const { data: existingAccounts } = await supabase
      .from('accounts')
      .select('sort_order')
      .eq('household_id', householdId);
    const nextSortOrder = (existingAccounts ?? []).reduce((m, a) => Math.max(m, a.sort_order ?? 0), 0) + 1;

    const { data: account, error } = await supabase
      .from('accounts')
      .insert({
        household_id: householdId,
        name: name.trim(),
        type,
        sort_order: nextSortOrder,
        statement_close_day: statementCloseDay ?? null,
        payment_day: paymentDay ?? null,
        goal_target: goalTarget ?? null,
        goal_target_date: goalTargetDate ?? null,
      })
      .select('id, name, type, statement_close_day, payment_day, goal_target, goal_target_date')
      .single();

    if (error) {
      console.error('Account create error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Opening balance — seeds a real ledger row (same "Starting balance"
    // pattern save-plan uses for imported goals), never a balance field
    // mutation. computeGoalBalance() (Σ transfer transactions) stays the
    // single source of truth. Used for a debt account's starting negative
    // balance ("Credit line: −$5,000"); no chequing-side peer, since this is
    // money the household already owed/had before Phare, not a transfer
    // happening today.
    if (openingBalance != null && Number(openingBalance) !== 0) {
      const timezone = await getHouseholdTimezone(supabase, householdId);
      const { error: openingErr } = await supabase.from('transactions').insert({
        household_id: householdId,
        member_id: null,
        category_id: null,
        description: 'Starting balance / Solde initial',
        amount: Number(openingBalance),
        date: businessToday(timezone),
        type: 'transfer',
        source: 'manual',
        account_id: account.id,
      });
      if (openingErr) {
        console.error('Account opening balance insert error:', openingErr);
        // Non-fatal: account created, just the opening balance didn't seed.
      }
    }

    // Log created_first_goal the first time a goal account is created.
    const goalTypes = new Set<string>(GOAL_ACCOUNT_TYPES);
    if (goalTypes.has(type) && await isFirstEvent(supabase, householdId, 'created_first_goal')) {
      await logEvent(supabase, householdId, user?.id ?? null, 'created_first_goal', { account_type: type });
    }

    return NextResponse.json({ account });
  } catch (error) {
    console.error('Account POST threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}