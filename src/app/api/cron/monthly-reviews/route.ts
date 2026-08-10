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
//
// BUT DELETE-ON-FAILURE ONLY COVERS FAILURES WE LIVE TO HANDLE. If the function
// is KILLED mid-generation — platform timeout, OOM — no catch runs, and the
// empty claim survives exactly as if it had never been guarded. Every later run
// then hits 23505 and reports `claimed_by_other`, which is indistinguishable in
// the logs from healthy idempotency, so the household silently never gets that
// month. Two Sonnet calls at 40–90s under a platform ceiling that may sit below
// the maxDuration declared here makes that a live risk, not a theoretical one.
//
// SO AN EMPTY CLAIM EXPIRES. A row with `messages = []` older than
// STUCK_CLAIM_MS is a corpse, not a claim: the next run deletes it and proceeds.
// See the constant for why the threshold is where it is.
// ---------------------------------------------------------------------------

export const maxDuration = 300;

// How long an empty claim may sit before the next run treats it as abandoned.
//
// The floor is the longest a LEGITIMATE generation can hold an empty claim, and
// that is bounded by the function's own lifetime — maxDuration, 300s above. The
// ceiling is the gap between runs: on a daily cron, any threshold under 24h
// behaves identically for the scheduled path, because the next run is a day
// later either way. The threshold therefore only bites when two runs overlap
// closely — a double-pressed Run button, a manual curl beside the cron.
//
// That makes the choice one-sided: too tight reclaims live work, too loose costs
// nothing anyone observes. 30 minutes is 6× the maxDuration ceiling and still
// far inside the daily gap.
const STUCK_CLAIM_MS = 30 * 60 * 1000;

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

        // ---- RECLAIM CORPSES BEFORE DECIDING ------------------------------
        // An empty claim past STUCK_CLAIM_MS is the wreckage of a run that was
        // killed before its catch could release it. Left alone it satisfies the
        // uniqueness check forever, so this has to happen BEFORE the months are
        // handed to decideReview — otherwise the corpse reads as
        // `already_generated` and the claim insert is never reached.
        const { data: existing } = await admin
          .from('conversations')
          .select('id, review_month, messages, created_at, generated_by')
          .eq('household_id', householdId)
          .not('review_month', 'is', null);

        const existingRows = (existing ?? []) as {
          id: string;
          review_month: string;
          messages: unknown[] | null;
          created_at: string;
          generated_by: string | null;
        }[];

        const corpseCutoff = Date.now() - STUCK_CLAIM_MS;
        const corpses = existingRows.filter(
          (r) => (r.messages?.length ?? 0) === 0 && Date.parse(r.created_at) < corpseCutoff
        );

        // Ids actually removed. A corpse whose delete FAILS stays in
        // existingReviewMonths on purpose: reporting `already_generated` is
        // less confusing than walking into a 23505 we already predicted.
        const reclaimedIds = new Set<string>();

        if (corpses.length > 0) {
          const ids = corpses.map((c) => c.id);
          const { error: reclaimErr } = await admin
            .from('conversations')
            .delete()
            .in('id', ids);

          if (reclaimErr) {
            console.error(
              'Cron monthly-reviews — found abandoned empty claim(s) but could not delete them. ' +
              'These BLOCK their month until removed by hand:',
              householdId, corpses.map((c) => `${c.id}@${c.review_month}`), reclaimErr
            );
          } else {
            ids.forEach((id) => reclaimedIds.add(id));
            // Error level on purpose. The row is unblocked, but a generation
            // died without ever logging why, and this line is the only record
            // that it happened at all. It also warns that months OTHER than
            // last month are not regenerated by this sweep — the cron only ever
            // targets previousMonthOf(today), so an older reclaimed month stays
            // missing until someone backfills it.
            console.error(
              'Cron monthly-reviews — RECLAIMED abandoned empty claim(s); a previous run was ' +
              'killed mid-generation without releasing them:',
              householdId, corpses.map((c) => `${c.id}@${c.review_month}`)
            );
          }
        }

        const liveRows = existingRows.filter((r) => !reclaimedIds.has(r.id));

        // A MANUAL ROW DOES NOT SETTLE ITS MONTH. Someone who pressed
        // Regenerate on 14 August has a real letter for '2026-08', but it
        // describes half a month. Counting it as generated would mean the cron
        // reports `claimed_by_other` on 1 September — indistinguishable from
        // healthy idempotency — and that household's August review is
        // permanently the mid-month draft. Only 'cron' rows, and legacy rows
        // predating the column, settle a month.
        const existingReviewMonths = liveRows
          .filter((r) => r.generated_by !== 'manual')
          .map((r) => r.review_month);

        const decision = decideReview({ householdId, localToday, history, existingReviewMonths });
        if (!decision.due) {
          outcomes.push({ householdId, status: 'skipped', reason: decision.reason });
          continue;
        }

        const month = decision.month;

        // The manual row this run is about to supersede, if there is one.
        const manualRow = liveRows.find(
          (r) => r.review_month === month && r.generated_by === 'manual'
        );

        // ---- THE CLAIM ----------------------------------------------------
        // Two shapes, because the two cases have different things to protect.
        //
        // FRESH MONTH: insert an empty row. The unique index is the lock — the
        // insert either wins or raises 23505.
        //
        // TAKEOVER of a manual row: flip generated_by to 'cron' and LEAVE THE
        // TEXT ALONE. The flip is the claim (it is a compare-and-swap on
        // generated_by='manual', so only one run can win it) and the row keeps
        // occupying the unique slot throughout, so no second run can insert.
        //
        // WHY NOT EMPTY THE ROW LIKE THE FRESH PATH DOES: because the failure
        // path deletes what it claimed. Emptying first would mean a transient
        // Anthropic error destroys a letter the family may have paid a refresh
        // for, and leaves nothing in its place. Holding the slot without
        // touching the text means the worst case is the manual letter surviving
        // one more month — which is exactly the right worst case.
        let claimId: string;
        let tookOverManual = false;

        if (manualRow) {
          const { data: taken, error: takeErr } = await admin
            .from('conversations')
            .update({ generated_by: 'cron' })
            .eq('id', manualRow.id)
            .eq('generated_by', 'manual') // compare-and-swap
            .select('id');

          if (takeErr) {
            console.error('Cron monthly-reviews — takeover failed:', householdId, month, takeErr);
            outcomes.push({ householdId, status: 'failed', month, reason: 'claim_failed' });
            continue;
          }
          if (!taken || taken.length === 0) {
            // Another run flipped it first. Same meaning as a 23505.
            outcomes.push({ householdId, status: 'claimed_by_other', month });
            continue;
          }
          claimId = manualRow.id;
          tookOverManual = true;
        } else {
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
              generated_by: 'cron',
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
          claimId = claim.id;
        }

        // ---- Generate, and release the claim if it fails ------------------
        try {
          const { topRecommendation, reviewText } = await generateMonthlyReview({
            supabase: admin,
            householdId,
            locale: household.locale === 'fr' ? 'fr' : 'en',
            timezone,
            // THE SAME `month` THE CLAIM WAS FILED UNDER. The service used to
            // derive its own window from the current calendar month, so this
            // run — at 07:00 on the 1st — produced a letter about the month
            // that had just STARTED and stored it as the month that had just
            // ended. The row was labelled correctly and read wrongly.
            reviewMonth: month,
            userId: null,
          });

          const locale = household.locale === 'fr' ? 'fr' : 'en';
          const { data: filled, error: fillErr } = await admin
            .from('conversations')
            .update({
              messages: [
                { role: 'assistant', type: 'top_recommendation', content: topRecommendation, locale },
                { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
              ],
              // The date the page shows for this letter. On a takeover the row
              // predates this text by weeks, and displaying the manual row's
              // creation date next to the cron's letter would misdate it.
              created_at: new Date().toISOString(),
            })
            .eq('id', claimId)
            .select('id');

          if (fillErr) throw new Error(`could not write review text: ${fillErr.message}`);

          // ZERO ROWS UPDATED — our claim was reclaimed as a corpse while this
          // generation was still running, and an overlapping run now owns the
          // month. Nothing is lost or duplicated: the unique index still allows
          // only one row, and the run that reclaimed it writes the review. But
          // without this check the update silently matches nothing and we
          // report `generated` for text that went nowhere.
          if (!filled || filled.length === 0) {
            console.error(
              'Cron monthly-reviews — claim %s was reclaimed while this run was still generating; ' +
              'the review text was discarded and an overlapping run owns %s:',
              claimId, month, householdId
            );
            outcomes.push({ householdId, status: 'failed', month, reason: 'claim_reclaimed' });
          } else {
            outcomes.push({ householdId, status: 'generated', month });
          }
        } catch (genErr) {
          // RELEASE THE CLAIM — but "release" means something different for
          // each shape, and getting this wrong destroys a real letter.
          //
          // TAKEOVER: flip generated_by back to 'manual'. The row still holds
          // the family's own letter, untouched; reverting the label makes the
          // month eligible again so the next run can retry the takeover.
          // DELETING here would erase a letter they may have paid for, to clean
          // up a claim that never emptied anything.
          //
          // FRESH: delete the empty row, as before. An empty claim left behind
          // satisfies the uniqueness check on every future run, so the
          // household would silently never receive this month's review — a
          // permanent failure produced by a transient one.
          const { error: cleanupErr } = tookOverManual
            ? await admin
                .from('conversations')
                .update({ generated_by: 'manual' })
                .eq('id', claimId)
            : await admin
                .from('conversations')
                .delete()
                .eq('id', claimId);

          if (cleanupErr) {
            // The one case needing a human: the claim survives and will block
            // retries until it is fixed by hand.
            // BOTH errors. cleanupErr says the row is stuck; genErr says why
            // the generation failed in the first place — and that is the one
            // you need to know whether a retry will work. Logging only the
            // cleanup failure tells you which row to fix and nothing about
            // whether fixing it helps.
            //
            // The remedy differs by shape, so it is spelled out rather than
            // left as "delete row X" — deleting a taken-over row would throw
            // away the family's own letter, which is the opposite of the fix.
            console.error(
              'Cron monthly-reviews — GENERATION FAILED AND CLAIM COULD NOT BE RELEASED. ' +
              'Row %s, month %s: %s, or this household never gets that month. ' +
              'Generation error:',
              claimId, month,
              tookOverManual
                ? "SET generated_by='manual' (do NOT delete — the row holds the family's own letter)"
                : 'DELETE the row (it is an empty claim)',
              genErr, '| Cleanup error:', cleanupErr
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

    // A SUCCESSFUL SWEEP MUST LEAVE A TRACE. The outcomes array only ever
    // existed in the response body, which nothing reads on the scheduled path —
    // so a healthy run and a run that skipped every household for the wrong
    // reason looked identical in Vercel's logs: one 200 and a duration.
    console.log(
      'Cron monthly-reviews —',
      JSON.stringify({ checked: outcomes.length, generated, failed, outcomes })
    );

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
