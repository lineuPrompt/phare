import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { occurrencesInMonth } from '@/lib/dateHelpers';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// PATCH: edit one expense
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { date, description, categoryId, amount, accountId } = await request.json();

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: existing, error: existingError } = await supabase
      .from('transactions')
      .select('id, date, description, amount, type, category_id, account_id, recurring_item_id, is_bridge')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Expense not found or not accessible' }, { status: 404 });
    }

    if (existing.type === 'expense' && !existing.is_bridge && !categoryId) {
      return NextResponse.json({ error: 'Category required for expenses' }, { status: 400 });
    }

    let recurringItemId = existing.recurring_item_id as string | null;

    if (!recurringItemId) {
      let ruleQuery = supabase
        .from('recurring_items')
        .select('id, cadence, anchor_date, second_day')
        .eq('household_id', householdId)
        .eq('description', existing.description)
        .eq('amount', existing.amount)
        .eq('type', existing.type);

      ruleQuery = existing.category_id
        ? ruleQuery.eq('category_id', existing.category_id)
        : ruleQuery.is('category_id', null);

      const { data: matchingRules, error: matchingRulesError } = await ruleQuery;
      if (matchingRulesError) {
        return NextResponse.json({ error: matchingRulesError.message }, { status: 500 });
      }

      const existingMonth = existing.date.slice(0, 7);
      const matchingRule = (matchingRules ?? []).find((rule) =>
        occurrencesInMonth(
          {
            cadence: rule.cadence as 'monthly' | 'biweekly' | 'semimonthly',
            anchorDate: rule.anchor_date,
            secondDay: rule.second_day,
          },
          existingMonth
        ).includes(existing.date)
      );
      recurringItemId = matchingRule?.id ?? null;
    }

    const { data, error } = await supabase
      .from('transactions')
      .update({
        date,
        description: description?.trim(),
        category_id: categoryId || null,
        account_id: accountId || null,
        amount,
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('id, category_id, account_id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Expense not found or not accessible' }, { status: 404 });
    }

    if (recurringItemId && accountId && accountId !== existing.account_id) {
      const { error: ruleError } = await supabase
        .from('recurring_items')
        .update({ account_id: accountId })
        .eq('id', recurringItemId)
        .eq('household_id', householdId);

      if (ruleError) {
        return NextResponse.json({ error: ruleError.message }, { status: 500 });
      }

      const { error: seriesError } = await supabase
        .from('transactions')
        .update({ account_id: accountId })
        .eq('household_id', householdId)
        .eq('recurring_item_id', recurringItemId)
        .gte('date', existing.date);

      if (seriesError) {
        return NextResponse.json({ error: seriesError.message }, { status: 500 });
      }

      let orphanQuery = supabase
        .from('transactions')
        .delete()
        .eq('household_id', householdId)
        .is('recurring_item_id', null)
        .eq('description', existing.description)
        .eq('amount', existing.amount)
        .eq('type', existing.type)
        .gte('date', existing.date);

      orphanQuery = existing.category_id
        ? orphanQuery.eq('category_id', existing.category_id)
        : orphanQuery.is('category_id', null);

      const { error: orphanError } = await orphanQuery;
      if (orphanError) {
        return NextResponse.json({ error: orphanError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ updated: true, expense: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE: remove one expense, or the whole future series (?series=true)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const series = url.searchParams.get('series') === 'true';

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    if (series) {
      const { data: row } = await supabase
        .from('transactions')
        .select('recurrence_id, date')
        .eq('id', id)
        .eq('household_id', householdId)
        .single();

      if (row?.recurrence_id) {
        await supabase
          .from('transactions')
          .delete()
          .eq('household_id', householdId)
          .eq('recurrence_id', row.recurrence_id)
          .gte('date', row.date);
        return NextResponse.json({ deleted: true, series: true });
      }
    }

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('DELETE error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('DELETE threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
