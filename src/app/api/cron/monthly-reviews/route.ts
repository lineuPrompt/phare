import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { businessToday } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { decideReview } from '@/lib/reviewSchedule';
import { generateMonthlyReview } from '@/lib/monthlyReviewService';

// ---------------------------------------------------------------------------
// GET /api/cron/monthly-reviews — month-end review generation.
//
// SCHEDULE: DAILY AT 07:00 UTC — and this is a CONSTRAINT, not a preference.
//
// Vercel Hobby permits daily cron jobs only. The original hourly schedule
// (0 * * * *) was rejected at deployment VALIDATION, which silently blocked
// five consecutive deployments — no build ran at all, so it did not look like a
// cron problem. If this ever needs to be finer-grained again, that is a Vercel
// Pro decision ($20/mo), not a code change.
//
// WHY ONE DAILY RUN IS CORRECT FOR CANADA. 07:00 UTC lands in the small hours
// across every Canadian zone:
//
//     zone           summer (DST)          winter (standard)
//     Pacific        00:00 same day        23:00 PREVIOUS day
//     Mountain       01:00                 00:00
//     Central        02:00                 01:00
//     Eastern        03:00                 02:00
//     Atlantic       04:00                 03:00
//     Newfoundland   04:30                 03:30
//
// Note the Pacific winter row: 07:00 UTC is 23:00 the day BEFORE. That does not
// break anything — the run whose local date is the 1st simply arrives one UTC
// day later, landing at 23:00 on the 1st in Vancouver. Verified by simulating a
// full year at both offsets: every zone gets EXACTLY ONE run per month whose
// local date is the 1st. Never zero, never two.
//
// THIS IS CORRECT FOR CANADA ONLY. The whole scheme depends on the country
// spanning roughly UTC-8 to UTC-2:30, so a single instant is "the small hours"
// everywhere in it. Serving households outside that span would need either a
// second daily run at a complementary hour, or hourly on Vercel Pro. Adding a
// non-Canadian household without doing one of those would silently skip them —
// their local date would never be the 1st when the job fires.
//
// THE PER-HOUSEHOLD CHECK STAYS regardless. Asking "is it the 1st where THIS
// family lives?" is what makes a single daily run CORRECT rather than
// coincidentally right for the current schedule — and it is what will keep this
// honest if the schedule ever changes. Without it, a daily UTC job would
// generate a Vancouver household's July review at 4pm on 31 July, narrating a
// month still in progress as though it had ended.
//
// AUTHENTICATED. Without CRON_SECRET this is a public endpoint that spends
// money on demand: each household it processes makes two Anthropic calls on the
// most expensive prompts in the app.
//
// PRO GATE AND QUOTA DO NOT APPLY HERE, deliberately. Entitlement asks who may
// REQUEST a review; a scheduled one is not requested. And the quota bounds what
// a user may spend on demand — a monthly generation must not eat the four
// refreshes a household paid for. Both stay in POST /api/regenerate-plan.
//
// IDEMPOTENCY IS A CLAIM, NOT A LOOK. The row is inserted BEFORE generating, so
// the unique index on (household_id, review_month) is what serialises two
// overlapping runs: the insert either wins or raises 23505. A read-then-write
// check would leave a window in which both runs see "not generated" and both
// pay for a generation.
//
// AND THE CLAIM IS DELETED IF GENERATION FAILS. Without that, a transient
// Anthropic error leaves a claim with no content that BLOCKS THE RETRY
// FOREVER — the household silently never receives that month, and nothing
// surfaces it. This is the failure mode the claim-first design creates, and
// deleting on failure is the price of it.
// ---------------------------------------------------------------------------

export const maxDuration = 300;

type Outcome = {
  householdId: string;
  status: 'generated' | 'skipped' | 'claimed_by_other' | 'failed';
  month?: string;
  reason?: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('Cron monthly-reviews — CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const outcomes: Outcome[] = [];

  try {
    const { data: households, error } = await admin
      .from('households')
      .select('id, locale');

    if (error) {
      console.error('Cron monthly-reviews — could not list households:', error);
      return NextResponse.json({ error: 'household_list_failed' }, { status: 503 });
    }

    for (const household of (households ?? []) as { id: string; locale: string | null }[]) {
      const householdId = household.id;

      // PER-HOUSEHOLD ISOLATION. One family's failure must never stop the rest:
      // a bare Promise.all or an unguarded loop would abandon every household
      // after the first error, with no record of where it stopped.
      try {
        const timezone = await getHouseholdTimezone(admin, householdId);
        const localToday = businessToday(timezone);

        // Months with real ledger data, for the SAME threshold the coaching
        // layer uses. A second definition of "enough history" would drift from
        // the one the review's own prose is built on.
        const { data: txMonths } = await admin
          .from('transactions')
          .select('date')
          .eq('household_id', householdId);

        const monthsWithData = new Set(
          ((txMonths ?? []) as { date: string }[]).map((t) => t.date.slice(0, 7))
        );
        const history = [...monthsWithData].map((month) => ({ month, hasRealData: true }));

        const { data: existing } = await admin
          .from('conversations')
          .select('review_month')
          .eq('household_id', householdId)
          .not('review_month', 'is', null);

        const existingReviewMonths = ((existing ?? []) as { review_month: string }[])
          .map((r) => r.review_month);

        const decision = decideReview({ householdId, localToday, history, existingReviewMonths });
        if (!decision.due) {
          outcomes.push({ householdId, status: 'skipped', reason: decision.reason });
          continue;
        }

        const month = decision.month;

        // ---- THE CLAIM. Insert first; the unique index is the lock. --------
        const { data: claim, error: claimErr } = await admin
          .from('conversations')
          .insert({
            household_id: householdId,
            // No author: a scheduled review is not written by a member, and
            // recording one would be a small lie. conversations.user_id is
            // already nullable (ON DELETE SET NULL against users).
            user_id: null,
            type: 'monthly_review',
            review_month: month,
            messages: [],
          })
          .select('id')
          .single();

        if (claimErr) {
          // 23505 — another run (or an earlier hour) already claimed this
          // month. Not an error: exactly what the claim is for.
          if ((claimErr as { code?: string }).code === '23505') {
            outcomes.push({ householdId, status: 'claimed_by_other', month });
            continue;
          }
          console.error('Cron monthly-reviews — claim failed:', householdId, month, claimErr);
          outcomes.push({ householdId, status: 'failed', month, reason: 'claim_failed' });
          continue;
        }

        // ---- Generate, and release the claim if it fails ------------------
        try {
          const { topRecommendation, reviewText } = await generateMonthlyReview({
            supabase: admin,
            householdId,
            locale: household.locale === 'fr' ? 'fr' : 'en',
            timezone,
            userId: null,
          });

          const locale = household.locale === 'fr' ? 'fr' : 'en';
          const { error: fillErr } = await admin
            .from('conversations')
            .update({
              messages: [
                { role: 'assistant', type: 'top_recommendation', content: topRecommendation, locale },
                { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
              ],
            })
            .eq('id', claim.id);

          if (fillErr) throw new Error(`could not write review text: ${fillErr.message}`);

          outcomes.push({ householdId, status: 'generated', month });
        } catch (genErr) {
          // RELEASE THE CLAIM. An empty claim left behind would satisfy the
          // uniqueness check on every future run, so this household would
          // silently never receive this month's review — a permanent failure
          // produced by a transient one.
          const { error: cleanupErr } = await admin
            .from('conversations')
            .delete()
            .eq('id', claim.id);

          if (cleanupErr) {
            // The one case needing a human: the claim survives and will block
            // retries until it is removed by hand.
            console.error(
              'Cron monthly-reviews — GENERATION FAILED AND CLAIM COULD NOT BE RELEASED. ' +
              'Delete conversations row %s or this household never gets %s:',
              claim.id, month, cleanupErr
            );
            outcomes.push({ householdId, status: 'failed', month, reason: 'claim_stuck' });
          } else {
            console.error('Cron monthly-reviews — generation failed, claim released:', householdId, month, genErr);
            outcomes.push({ householdId, status: 'failed', month, reason: 'generation_failed' });
          }
        }
      } catch (householdErr) {
        console.error('Cron monthly-reviews — household threw:', householdId, householdErr);
        outcomes.push({ householdId, status: 'failed', reason: 'unexpected' });
      }
    }

    const generated = outcomes.filter((o) => o.status === 'generated').length;
    const failed = outcomes.filter((o) => o.status === 'failed').length;

    // Always 200 once authenticated: a non-2xx makes Vercel retry the WHOLE
    // sweep, re-walking every household to re-skip them. Per-household failures
    // are reported in the body and logged, and the claim design makes the next
    // scheduled run the natural retry.
    return NextResponse.json({ ok: true, checked: outcomes.length, generated, failed, outcomes });
  } catch (err) {
    console.error('Cron monthly-reviews — sweep threw:', err);
    return NextResponse.json({ error: 'sweep_failed', outcomes }, { status: 500 });
  }
}
