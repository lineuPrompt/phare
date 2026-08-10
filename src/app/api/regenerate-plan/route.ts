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

    // THE MONTH THIS REFRESH IS ABOUT: the one in progress.
    //
    // A family who corrects an August entry and presses Regenerate wants the
    // August letter to reflect the correction. Targeting the last COMPLETED
    // month would hand them a July letter that ignores the very edit they made,
    // which fails the case the button exists for.
    const reviewMonth = businessMonth(timezone);

    // ── REFUSE WHILE THE CRON IS MID-GENERATION FOR THIS MONTH ───────────────
    // The cron holds a fresh month by inserting an empty row and filling it a
    // minute later. If a manual refresh upserted into that window, the cron's
    // fill would overwrite the family's letter — or its failure path would
    // delete it — after they had already spent a refresh on it. Rare, since the
    // cron targets the month that just ENDED and this targets the one in
    // progress, so the two normally address different rows; possible via a
    // manual cron trigger. Checked BEFORE reserveRegeneration so a refused
    // request never costs a refresh.
    const { data: activeClaim } = await supabase
      .from('conversations')
      .select('id, messages')
      .eq('household_id', householdId)
      .eq('review_month', reviewMonth)
      .maybeSingle();

    if (activeClaim && ((activeClaim.messages as unknown[] | null)?.length ?? 0) === 0) {
      return NextResponse.json(
        {
          error: 'A review is being written right now. Please try again in a minute.',
          code: 'review_in_progress',
        },
        { status: 409 }
      );
    }

    // Claim the slot BEFORE generating. Everything below this line costs money,
    // and this is placed after the timezone lookup only so the quota's calendar
    // month reuses it rather than resolving the household twice.
    const reservation = await reserveRegeneration(
      supabase, householdId, user.id, reviewMonth
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
      reviewMonth,
      userId: user.id,
    });

    // ── Save: ONE REVIEW PER MONTH, so this REPLACES ─────────────────────────
    // review_month is now set, reversing the previous rule. It used to be left
    // NULL precisely so a refresh could never collide with the cron — but the
    // cost was a row per press, and a household that regenerated a few times
    // accumulated an archive that read as noise. Under one-per-month the
    // collision is handled by `generated_by` instead: this row is 'manual', and
    // the cron may replace it with the real end-of-month letter.
    //
    // THE PREVIOUS TEXT IS GONE, deliberately. A family who corrected an entry
    // and regenerated wants the corrected letter, not both. The UI warns before
    // this happens and names the month.
    //
    // created_at is set explicitly: the archive shows it as when the letter was
    // written, and on a replacement the row's original insert time would
    // misdate text produced just now.
    const { error: saveErr } = await supabase
      .from('conversations')
      .upsert(
        {
          household_id: householdId,
          user_id: user.id,
          type: 'monthly_review',
          review_month: reviewMonth,
          generated_by: 'manual',
          created_at: new Date().toISOString(),
          messages: [
            { role: 'assistant', type: 'top_recommendation', content: topRecommendation, locale },
            { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
          ],
        },
        // Inferrable only because the unique index was made TOTAL — PostgREST
        // emits no WHERE, and Postgres cannot infer a partial index from that.
        { onConflict: 'household_id,review_month' }
      );

    if (saveErr) {
      console.error('Regenerate plan — could not save the review:', saveErr);
      throw new Error('Your review was generated but could not be saved. Please try again.');
    }

    return NextResponse.json({ saved: true, topRecommendation, reviewText, reviewMonth });
  } catch (error) {
    console.error('Regenerate plan error:', error);
    return NextResponse.json({ error: 'Failed to regenerate plan' }, { status: 500 });
  }
}
