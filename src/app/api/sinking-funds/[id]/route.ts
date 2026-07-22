import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/**
 * PATCH /api/sinking-funds/[id]
 *
 * Edits one allocation line ("what this buffer covers" — Build 4 Part A
 * follow-up, 2026-07-22). Only touches the sinking_funds row itself: amount
 * fields and the soft `active` (excluded/included) flag. Never touches the
 * buffer's actual recurring contribution — the page recomputes
 * sum(active allocations) client-side from this response's fresh total and,
 * if it now differs from the buffer's real contribution, drives that change
 * through the EXISTING PATCH /api/recurring/[id] effective-dated machinery
 * itself (same call the buffer's own "edit contribution" button already
 * makes) — no new backend logic for that half.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id;

    const { data: current } = await supabase
      .from('sinking_funds')
      .select('id')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();
    if (!current) return NextResponse.json({ error: 'Sinking fund not found' }, { status: 404 });

    const hasAnnual = body.annualAmount !== undefined;
    const hasMonthly = body.monthlyProvision !== undefined;
    const hasActive = typeof body.active === 'boolean';

    if (!hasAnnual && !hasMonthly && !hasActive) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updates: Record<string, number | boolean> = {};

    if (hasAnnual) {
      const v = Number(body.annualAmount);
      if (!(v > 0) || isNaN(v)) {
        return NextResponse.json({ error: 'Annual amount must be a positive number' }, { status: 400 });
      }
      updates.annual_amount = v;
    }
    if (hasMonthly) {
      const v = Number(body.monthlyProvision);
      if (!(v > 0) || isNaN(v)) {
        return NextResponse.json({ error: 'Monthly amount must be a positive number' }, { status: 400 });
      }
      updates.monthly_provision = v;
    }
    if (hasActive) {
      updates.active = body.active;
    }

    const { error: updateErr } = await supabase
      .from('sinking_funds')
      .update(updates)
      .eq('id', id)
      .eq('household_id', householdId);
    if (updateErr) {
      console.error('Sinking fund PATCH error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const { data: allFunds } = await supabase
      .from('sinking_funds')
      .select('monthly_provision, active')
      .eq('household_id', householdId);
    const totalMonthlyProvision = Math.round(
      (allFunds ?? [])
        .filter((f) => f.active !== false)
        .reduce((sum, f) => sum + Number(f.monthly_provision ?? 0), 0) * 100
    ) / 100;

    return NextResponse.json({ updated: true, totalMonthlyProvision });
  } catch (error) {
    console.error('Sinking fund allocation PATCH threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
