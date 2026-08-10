/**
 * POST /api/regenerate-plan
 *
 * Re-runs the financial plan and review against the household's CURRENT live
 * data, then saves a new conversation row.
 *
 * SINGLE SOURCE OF TRUTH: transactions for the current calendar month
 * -------------------------------------------------------------------
 * Both income AND expenses come from the materialized transactions table via
 * a single computeMonthTotals() call — the identical function the Expenses
 * page uses.  Nothing is read from recurring_items or budgets for the
 * headline figures or the AI context.
 *
 * Why NOT recurring_items:
 *   recurring_items stores per-period amounts with real cadences.
 *   Summing r.amount without applying cadence gives one-of-each-source:
 *     income  →  $2,749 + $2,742 + $383 = $5,874  (should be $11,365)
 *     expense →  $1,200 bi-weekly mortgage counted once (should be $2,400+)
 *   Both bugs produce a wrong net that can flip surplus ↔ deficit.
 *
 * Why transactions:
 *   materializeRule() already ran at save time with the real cadence, so a
 *   bi-weekly item already has 2 or 3 rows in the month.  No frequency math
 *   is needed at read time — the correct count is in the DB.
 *
 * The AI receives pre-computed verified numbers. It is explicitly told not
 * to change or recalculate them. It only classifies and interprets.
 *
 * EXPENSE LINES for the AI context
 * ---------------------------------
 * Chequing expenses only — mirrors the computeMonthTotals rule that prevents
 * card/bridge double-counting.  This means card purchases appear as a single
 * bridge-payment line (e.g. "Visa payment: $1,847") rather than individual
 * merchant transactions.  The total remains correct; line granularity is a
 * known limitation acceptable for the review context.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessMonth } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { requirePro } from '@/lib/proGate';
import { reserveRegeneration } from '@/lib/regenerationQuotaServer';
import { generateMonthlyReview } from '@/lib/monthlyReviewService';

// GENERATION LIVES IN src/lib/monthlyReviewService.ts. This route keeps only
// what depends on there being a signed-in user asking: the session, the Pro
// gate, the quota, and persistence. The cron path shares the service and
// answers those questions differently — see the service's own header.

export async function POST(request: Request) {
  try {
    const { locale: rawLocale } = await request.json().catch(() => ({ locale: 'en' }));
    const locale = rawLocale === 'fr' ? 'fr' : 'en';

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    // Pro-only. Also the most expensive prompt in the app, so the gate is a
    // cost boundary as well as a product one.
    const gate = await requirePro(supabase, householdId, 'new_plan');
    if (!gate.allowed) return gate.response;

    // ── Current calendar month boundaries (household timezone, not the
    // server's UTC clock) ────────────────────────────────────────────────────
    // The service owns its own month boundaries now; the route needs the
    // timezone only for the quota's calendar month.
    const timezone = await getHouseholdTimezone(supabase, householdId);

    // Claim the slot BEFORE generating. Everything below this line costs money,
    // and this is placed after the timezone lookup only so the quota's calendar
    // month reuses it rather than resolving the household twice.
    const reservation = await reserveRegeneration(
      supabase, householdId, user.id, businessMonth(timezone)
    );
    if (!reservation.ok) {
      return NextResponse.json(
        {
          error: reservation.reason === 'exhausted'
            ? 'You have used all of this month’s review refreshes.'
            : 'Could not start a refresh right now. Please try again.',
          code: reservation.reason === 'exhausted' ? 'quota_exhausted' : 'quota_unavailable',
          quota: reservation.quota,
        },
        { status: reservation.reason === 'exhausted' ? 429 : 503 }
      );
    }
    const { topRecommendation, reviewText } = await generateMonthlyReview({
      supabase,
      householdId,
      locale,
      timezone,
      // UNCHANGED BEHAVIOUR, now stated instead of assumed. A manual refresh has
      // always reviewed the month in progress — the service derived exactly
      // this internally. Making it explicit is the whole point of the change:
      // the cron's window was wrong for the same reason this one was invisible.
      reviewMonth: businessMonth(timezone),
      userId: user.id,
    });

    // ── Save conversation row ─────────────────────────────────────────────────
    // review_month is deliberately absent: a manual regeneration is an ad-hoc
    // refresh, not the canonical monthly letter, and must stay outside the
    // uniqueness claim so pressing Regenerate never collides with the cron.
    await supabase.from('conversations').insert({
      household_id: householdId,
      user_id: user.id,
      type: 'monthly_review',
      messages: [
        { role: 'assistant', type: 'top_recommendation', content: topRecommendation, locale },
        { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
      ],
    });

    return NextResponse.json({ saved: true, topRecommendation, reviewText });
  } catch (error) {
    console.error('Regenerate plan error:', error);
    return NextResponse.json({ error: 'Failed to regenerate plan' }, { status: 500 });
  }
}
