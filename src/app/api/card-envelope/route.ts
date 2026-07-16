import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  categoryActualsForCard,
  uncategorizedSpend,
  totalSpendForCard,
  envelopeRemaining,
  envelopeStatus,
  EnvTx,
  CategoryEntryLine,
} from '@/lib/envelopeHelpers';
import { categoryDisplayName } from '@/lib/categoryTranslations';

async function resolveHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return data?.household_id ? { householdId: data.household_id as string, userId: user.id } : null;
}

// GET /api/card-envelope?cardId=<uuid>&month=YYYY-MM
// Returns the decision-view payload for one card and month:
//   card details, total goal, per-category sub-budgets + actuals, uncategorized, total spent.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cardId = url.searchParams.get('cardId');
    const monthParam = url.searchParams.get('month');
    const locale = url.searchParams.get('locale') === 'fr' ? 'fr' : 'en';

    if (!cardId || !monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'cardId and month (YYYY-MM) required' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await resolveHousehold(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { householdId } = ctx;

    // Card account details
    const { data: card } = await supabase
      .from('accounts')
      .select('id, name, type, statement_close_day, payment_day')
      .eq('id', cardId)
      .eq('household_id', householdId)
      .single();
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    // Card's total monthly goal (carry-forward: latest goal on or before this month)
    const monthStart = `${monthParam}-01`;
    const { data: goalRow } = await supabase
      .from('monthly_goals')
      .select('card_goal')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .lte('month', monthStart)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();

    const totalGoal: number | null = goalRow ? Number(goalRow.card_goal) : null;

    // Envelope items saved for exactly this month (month-scoped: editing one
    // month never touches another — see 20260714000000 migration).
    const { data: items } = await supabase
      .from('card_envelope_items')
      .select('category_id, monthly_amount, categories(name, name_fr)')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .eq('month', monthStart);

    // Transactions for this card in this month
    const [y, m] = monthParam.split('-').map(Number);
    const nextMonth = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const { data: rawTxns } = await supabase
      .from('transactions')
      .select('id, account_id, amount, category_id, type, date, is_bridge, description, installment_label')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .gte('date', monthStart)
      .lt('date', nextMonth);

    const txns = (rawTxns ?? []) as EnvTx[];
    const byCategory = categoryActualsForCard(txns, cardId, monthParam);

    // Per-category entry lines for the accordion — same rows the actuals
    // above are computed from, just grouped for display instead of summed.
    // Bridge lines are excluded (they're computed, not user entries).
    type RawTxn = EnvTx & { id: string; description: string | null; installment_label: string | null };
    const entriesByCategory: Record<string, CategoryEntryLine[]> = {};
    const uncategorizedEntries: CategoryEntryLine[] = [];
    for (const t of txns as RawTxn[]) {
      if (t.is_bridge) continue;
      const line: CategoryEntryLine = {
        id: t.id,
        date: t.date,
        description: t.description,
        amount: Number(t.amount),
        type: t.type as 'expense' | 'income',
        installmentLabel: t.installment_label,
      };
      if (t.category_id) {
        (entriesByCategory[t.category_id] ??= []).push(line);
      } else {
        uncategorizedEntries.push(line);
      }
    }

    // All household expense categories — needed both for the editor's
    // add-category dropdown and to name any category that has net activity
    // (e.g. a refund) but no saved envelope item.
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, name_fr')
      .eq('household_id', householdId)
      .eq('type', 'expense')
      .order('name');
    const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));

    const envelopeItems = (items ?? []).map((item) => {
      const cats = item.categories as unknown as { name: string; name_fr: string | null } | null;
      const monthlyAmount = Number(item.monthly_amount);
      const actual = byCategory.get(item.category_id) ?? 0;
      return {
        categoryId: item.category_id,
        categoryName: cats ? categoryDisplayName(cats, locale) : '?',
        monthlyAmount,
        actual,
        remaining: envelopeRemaining(monthlyAmount, actual),
        status: envelopeStatus(monthlyAmount, actual),
      };
    });

    // Categories with net activity (spend or a refund) but no saved envelope
    // item — still visible and netted, never a totals-only ghost.
    const coveredIds = new Set(envelopeItems.map((i) => i.categoryId));
    for (const [categoryId, actual] of byCategory) {
      if (coveredIds.has(categoryId)) continue;
      const cat = categoryById.get(categoryId);
      envelopeItems.push({
        categoryId,
        categoryName: cat ? categoryDisplayName(cat, locale) : '?',
        monthlyAmount: 0,
        actual,
        remaining: envelopeRemaining(0, actual),
        status: envelopeStatus(0, actual),
      });
    }

    const uncategorized = uncategorizedSpend(txns, cardId, monthParam);
    const totalSpent = totalSpendForCard(txns, cardId, monthParam);

    const categoriesForEditor = (categories ?? []).map((c) => ({
      id: c.id,
      name: categoryDisplayName(c, locale),
    }));

    return NextResponse.json({
      card,
      totalGoal,
      envelopeItems,
      uncategorized,
      totalSpent,
      categories: categoriesForEditor,
      entriesByCategory,
      uncategorizedEntries,
    });
  } catch (error) {
    console.error('GET /api/card-envelope error:', error);
    return NextResponse.json({ error: 'Failed to load envelope' }, { status: 500 });
  }
}

// POST /api/card-envelope
// Saves a card's complete envelope: total goal, category sub-budgets, statement days.
// Body: {
//   cardId: string, month: string (YYYY-MM),
//   totalGoal: number,
//   items: Array<{ categoryId: string, monthlyAmount: number }>,
//   statementCloseDay: number | null, paymentDay: number | null
// }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cardId, month, totalGoal, items, statementCloseDay, paymentDay } = body;

    if (!cardId || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'cardId and month required' }, { status: 400 });
    }
    if (typeof totalGoal !== 'number' || totalGoal < 0) {
      return NextResponse.json({ error: 'Invalid totalGoal' }, { status: 400 });
    }
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await resolveHousehold(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { householdId } = ctx;

    // Guard: account must belong to this household
    const { data: card } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', cardId)
      .eq('household_id', householdId)
      .single();
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    const monthStart = `${month}-01`;

    // 1. Upsert monthly goal for this card + month
    const { error: goalErr } = await supabase
      .from('monthly_goals')
      .upsert(
        { household_id: householdId, account_id: cardId, month: monthStart, card_goal: totalGoal },
        { onConflict: 'household_id,account_id,month' }
      );
    if (goalErr) {
      console.error('Envelope goal upsert error:', goalErr);
      return NextResponse.json({ error: 'Failed to save goal' }, { status: 500 });
    }

    // 2. Replace this month's envelope items only (month-scoped: never
    // touches another month's saved rows).
    const { error: delErr } = await supabase
      .from('card_envelope_items')
      .delete()
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .eq('month', monthStart);
    if (delErr) {
      console.error('Envelope items delete error:', delErr);
      return NextResponse.json({ error: 'Failed to update categories' }, { status: 500 });
    }

    if (items.length > 0) {
      const rows = items.map((item: { categoryId: string; monthlyAmount: number }) => ({
        household_id: householdId,
        account_id: cardId,
        category_id: item.categoryId,
        monthly_amount: item.monthlyAmount,
        month: monthStart,
      }));
      const { error: insErr } = await supabase.from('card_envelope_items').insert(rows);
      if (insErr) {
        console.error('Envelope items insert error:', insErr);
        return NextResponse.json({ error: 'Failed to save categories' }, { status: 500 });
      }
    }

    // 3. Update account statement days (only the fields provided)
    const accountUpdates: Record<string, number | null> = {};
    if (statementCloseDay !== undefined) accountUpdates.statement_close_day = statementCloseDay;
    if (paymentDay         !== undefined) accountUpdates.payment_day         = paymentDay;

    if (Object.keys(accountUpdates).length > 0) {
      const { error: acctErr } = await supabase
        .from('accounts')
        .update(accountUpdates)
        .eq('id', cardId)
        .eq('household_id', householdId);
      if (acctErr) {
        console.error('Account days update error:', acctErr);
        // Non-fatal: envelope saved, just the days didn't update
      }
    }

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error('POST /api/card-envelope error:', error);
    return NextResponse.json({ error: 'Failed to save envelope' }, { status: 500 });
  }
}
