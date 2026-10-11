// ---------------------------------------------------------------------------
// MONTHLY REVIEW GENERATION — extracted verbatim from POST /api/regenerate-plan.
//
// WHY THIS EXISTS: the review had no scheduled generation. Only save-plan (once,
// at onboarding) and the manual Regenerate button ever wrote one, so a household
// that onboarded in August was still shown its August letter in November. The
// cron that fixes that has no user session, and this logic was built entirely
// around one — auth.getUser(), an RLS-scoped client, a Pro gate and a quota.
//
// THE EXTRACTION WAS BYTE-FOR-BYTE. Lines 142-919 of the route moved here
// unchanged; the only additions are this header, the signature, and the return.
// Anything that looks like an improvement was NOT made on purpose: the failure
// mode being guarded against is not a crash but a guard that still runs, still
// passes, and silently guards nothing because its inputs were reordered in the
// move. Byte-identical output against fixed fixtures is the proof.
//
// WHAT STAYED IN THE ROUTE, deliberately:
//   requirePro           — entitlement asks who may REQUEST a review. A cron
//                          generating for a comped household must not be
//                          refused by a gate designed for a button press.
//   reserveRegeneration  — the quota bounds what a USER may spend on demand.
//                          A scheduled review is not discretionary and must not
//                          eat the four refreshes a household paid for.
//   persistence          — each caller writes its own row: the route as today,
//                          the cron with review_month and a null user_id.
//
// TENANCY. This accepts either an RLS-scoped session client or a service-role
// admin client, and that is safe for one specific reason: ALL EIGHT QUERIES
// BELOW FILTER household_id EXPLICITLY. RLS was never doing the scoping work
// here. Under an admin client those filters become the ONLY thing preventing a
// cross-tenant read, so they are load-bearing rather than belt-and-braces —
// pinned by the tenancy test, and never to be removed as "redundant".
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic } from '@/lib/anthropic';
import { assembleCalculatedBudget, dedupeSinkingFunds } from '@phare/core';
import { computeMonthTotals, computeGoalBalance, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { evaluateGoals, isDebtGoalName, computeDebtPayoff, addMonthsToMonth, monthsBetween, monthReachedByRules, GoalResult, DebtPayoffResult, type ReachRule } from '@/lib/goalHelpers';
import { detectWindfalls } from '@/lib/reviewContextHelpers';
import { loadCardCycleFacts, overTargetFromCardFacts, cardLetterFacts, type CardCycleFacts } from '@/lib/cardOverTarget';
import { loadMonthAhead, type MonthAheadFacts } from '@/lib/reviewMonthAhead';
import { checkLetterFigures, findNamesNotInPayload, LetterGuardError } from '@/lib/letterGuards';
import { categoryDisplayName } from '@/lib/categoryTranslations';
import { enforceDebtFigureInTopRecommendation, enforceBorrowedCashFraming, containsUnsubstitutedToken, DEBT_PAYMENT_PLACEHOLDER } from '@/lib/topRecommendationHelpers';
import { logEvent } from '@/lib/eventLogger';
import {
  computeSinkingFundUrgency,
  rankFundingNeeds,
  computeTypicalSurplus,
  computeInsufficientHistory,
  selectTopOverTargetCategory,
  computeFreedCapacityEvents,
  groupInstallmentSeries,
  computeStartingContribution,
  coachingFallbackApplies,
  buildFallbackReviewText,
  containsIllustrativeTokenLeak,
  contributionRuleFact,
  monthlyShortfall,
  FundingNeed,
  type ContributionRuleFact,
} from '@/lib/coachingHelpers';
// businessMonth is deliberately NOT imported: the reviewed window comes from
// the caller's `reviewMonth`, never from this service's own clock.
import { businessToday, SEED_EXPENSE_CATEGORIES } from '@phare/core';

// One list, in @phare/core — the same ten every household is seeded with.
const SEED_CATEGORIES = SEED_EXPENSE_CATEGORIES;

type Category = { name: string; budgeted: number; type: string };

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Return YYYY-MM-DD for the first day of the given month (0-indexed month). */
function firstOfMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}


export type GeneratedReview = {
  topRecommendation: string;
  reviewText: string;
};

export async function generateMonthlyReview({
  supabase,
  householdId,
  locale,
  timezone,
  reviewMonth,
  userId,
}: {
  /**
   * A session client OR a service-role client — both are SupabaseClient, and
   * typing it as such (rather than `any`) matters beyond tidiness: `any` erases
   * the inference every query callback in this file relies on, which would have
   * meant hand-annotating ~40 lambdas and touching the moved code.
   */
  supabase: SupabaseClient;
  householdId: string;
  locale: 'en' | 'fr';
  /** IANA zone. Passed in because both callers have already resolved it. */
  timezone: string;
  /**
   * THE MONTH THIS LETTER IS ABOUT, 'YYYY-MM'. Every figure is scoped to it and
   * the prompt pins the model to its name.
   *
   * REQUIRED, AND DELIBERATELY NOT DEFAULTED. This used to be derived here from
   * businessMonth(timezone) — the CURRENT calendar month — while the cron
   * labelled the row with the month that had just ENDED. So the cron, running
   * at 07:00 on 1 September to write August's review, produced a letter about
   * September with one day of data and filed it as August. Nothing in the row
   * showed the disagreement: the label was right, the prose was wrong, and only
   * reading the letter revealed it.
   *
   * A default would rebuild exactly that trap for the next caller. Making it
   * required means a new call site cannot compile without stating which month
   * it means.
   */
  reviewMonth: string;
  /**
   * Author of the guard-retry event, when there is one. NOT in the agreed
   * signature — found during the cut: the generation block itself calls
   * logEvent(..., user.id, 'review_text_guard_retried') at what was line 915,
   * so this block does depend on a user after all. The cron passes null, which
   * events.user_id already permits (ON DELETE SET NULL against auth.users).
   */
  userId: string | null;
}): Promise<GeneratedReview> {
  const lang = locale === 'fr' ? 'French (Quebec French, natural and native)' : 'English';

  // The reviewed window, derived from the CALLER'S month rather than from a
  // clock. See the reviewMonth doc above for what deriving it here cost.
  //
  // Rejected rather than defaulted: a malformed month would otherwise produce
  // NaN dates, and every query below would silently return nothing — a letter
  // about an empty month rather than an error.
  const parsedMonth = /^(\d{4})-(\d{2})$/.exec(reviewMonth);
  if (!parsedMonth) {
    throw new Error(`generateMonthlyReview: reviewMonth must be 'YYYY-MM', got "${reviewMonth}"`);
  }
  const year = Number(parsedMonth[1]);
  const month = Number(parsedMonth[2]) - 1; // 0-indexed, matching firstOfMonth
  if (month < 0 || month > 11) {
    throw new Error(`generateMonthlyReview: reviewMonth has no such month: "${reviewMonth}"`);
  }
  const monthStart = firstOfMonth(year, month);
  const monthEnd = firstOfMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);
  // Named for what it is. It was `reviewMonthLabel`, and that name is part of
  // why the bug above survived review: "current" read as correct.
  const reviewMonthLabel = monthStart.slice(0, 7); // YYYY-MM

    // ── recurring_item_id is now selected too (headline figures still come
    // entirely from computeMonthTotals over these same rows) — needed to
    // count each recurring item's occurrences this month for windfall
    // detection below (Part B.4). category_id/is_bridge/date are additive —
    // needed by the Coaching Layer's over-target-category sourcing below,
    // never used by the pre-existing headline/windfall/line-aggregation
    // logic, which still relies on the query's own monthStart/monthEnd
    // range exactly as before. ──
    const [allTxResult, acctResult, sfResult, historyResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('id, amount, type, description, account_id, recurring_item_id, transfer_peer_id, category_id, is_bridge, date')
        .eq('household_id', householdId)
        .gte('date', monthStart)
        .lt('date', monthEnd),

      supabase
        .from('accounts')
        .select('id, name, type, goal_target, goal_target_date, is_sinking_fund, statement_close_day, payment_day')
        .eq('household_id', householdId),

      supabase
        .from('sinking_funds')
        .select('name, annual_amount, monthly_provision, due_month, due_day, linked_account_id')
        .eq('household_id', householdId)
        .eq('active', true),

      // Coaching Layer (2026-07-25): one wide window covering the 3 complete
      // calendar months before this one (typical-surplus history) through 12
      // months ahead (real materialized future rows — same horizon
      // convention as the dashboard's month nav — long enough to find any
      // already-materialized installment series' real final row). Kept as
      // its own query rather than widening the query above so the existing
      // headline/windfall/line-aggregation logic above is untouched — it
      // still sees exactly the current month, nothing more. category_id/
      // is_bridge (2026-07-31) are additive: the card-envelope over-target
      // check below needs this same wide range (a live statement cycle can
      // extend a few days into the adjacent calendar month) but couldn't
      // reuse allTxns without widening ITS scope too — see the comment
      // right above this one, which still applies unchanged.
      supabase
        .from('transactions')
        .select('amount, type, account_id, date, recurring_item_id, installment_label, recurrence_id, description, category_id, is_bridge')
        .eq('household_id', householdId)
        .gte('date', `${addMonthsToMonth(monthStart.slice(0, 7), -3)}-01`)
        .lt('date', `${addMonthsToMonth(monthStart.slice(0, 7), 12)}-01`),
    ]);

    const allTxns = allTxResult.data ?? [];
    const accounts = acctResult.data ?? [];
    const sinkingFunds = sfResult.data ?? [];
    const historyRows = historyResult.data ?? [];

    // ── One call for all buckets (same function as Expenses page) ───────────
    const { totalIncome: incomeTotal, totalExpenses: expenseTotal, totalSavings, totalDebtPayments, totalBorrowed, netCashFlow, savingsByDestination } =
      computeMonthTotals(
        allTxns.map((tx) => ({
          id: tx.id,
          amount: Number(tx.amount),
          type: tx.type,
          account_id: tx.account_id,
          transfer_peer_id: tx.transfer_peer_id ?? null,
        })),
        accounts,
      );

    const chequingIds = new Set(
      accounts.filter((a) => a.type === 'chequing').map((a) => a.id),
    );

    // ── Goals & debt payoff: code-computed from REAL goal accounts, never
    // AI-invented. Every account with a goal_target is a real, user-set goal
    // (created via onboarding or the Goals page) — mirrors api/plan/route.ts's
    // template-source handling exactly, just reading accounts instead of a
    // parsed sheet. Requires full (all-time) transaction history per goal
    // account, not just this month's window, so computeGoalBalance sees the
    // real running balance (same fetch dashboard/route.ts uses). ──────────
    const goalAccountList = accounts.filter(
      (a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type) && a.goal_target != null && !a.is_sinking_fund
    );
    // Sinking-fund accounts are fetched into the same tx pull too (Build 4
    // Part 2, 2026-07-21) — they never carry a goal_target, so goalAccountList
    // naturally excludes them, but their own balance still needs computing
    // for the sinkingFunds section below.
    const fundAccountIds = accounts.filter((a) => a.is_sinking_fund).map((a) => a.id);
    const goalIds = [...goalAccountList.map((a) => a.id), ...fundAccountIds];
    let goalTxData: { amount: number | string; type: string; account_id: string | null; date?: string; is_opening_balance?: boolean | null }[] = [];
    if (goalIds.length > 0) {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, account_id, date, is_opening_balance')
        .eq('household_id', householdId)
        .in('account_id', goalIds);
      goalTxData = data ?? [];
    }
    const today = businessToday(timezone);
    const rawGoals = goalAccountList.map((a) => ({
      accountId: a.id as string,
      name: a.name,
      targetAmount: Number(a.goal_target),
      // Today-cutoff balance: recurring transfers materialize future-dated
      // rows ahead of time (Phase 2) — a goal/debt's real progress must
      // never count a payment that hasn't happened yet.
      savedSoFar: computeGoalBalance(goalTxData, a.id, today),
      targetDate: a.goal_target_date ?? null,
      isDebt: a.type === 'debt',
    }));
    // Debt detection: an explicitly-typed debt ACCOUNT (Build 4 Phase 3)
    // always wins — isDebtGoalName's keyword match is retired the moment a
    // real debt type exists, and remains only as a fallback for goals that
    // predate this feature or came from a typeless template import (where no
    // account type is available yet — see api/plan/route.ts, unchanged).
    const explicitDebt = rawGoals.find((g) => g.isDebt);
    const debtGoalLine = explicitDebt ?? rawGoals.find((g) => isDebtGoalName(g.name));
    const nonDebtGoals = rawGoals.filter((g) => g !== debtGoalLine);
    const computedDebtPayoff: DebtPayoffResult | null = computeDebtPayoff(debtGoalLine, today);
    const computedGoals: GoalResult[] = evaluateGoals(nonDebtGoals, netCashFlow, today);

    // ── Recurring contributions & debt payments already committed ───────────
    // Fetched so the AI can narrate them as already-netted-out capacity
    // ("your $500/mo RRSP contribution is already counted") rather than
    // treating net cash flow as fully discretionary. Code-computed list,
    // never a number the AI invents — it only narrates what's here.
    const { data: recurringTransferRows } = await supabase
      .from('recurring_items')
      .select('amount, cadence, anchor_date, second_day, effective_from, destination_account_id, accounts:accounts!recurring_items_destination_account_id_fkey(name, type)')
      .eq('household_id', householdId)
      .eq('type', 'transfer')
      .eq('active', true);
    const transferRuleRows = (recurringTransferRows ?? []) as unknown as {
      amount: number | string;
      cadence: string;
      anchor_date?: string | null;
      second_day?: number | null;
      effective_from?: string | null;
      destination_account_id?: string | null;
      accounts: { name: string; type: string } | null;
    }[];
    const committedTransfers = transferRuleRows
      .map((r) => ({
        destination: r.accounts?.name ?? 'goal',
        isDebtPayment: r.accounts?.type === 'debt',
        amount: Number(r.amount),
        cadence: r.cadence,
      }));

    // ── What the household actually puts into each account (2026-10-10) ──────
    // The household's own recurring transfers into an account, and what landed
    // there in the reviewed month — kept apart from what a goal REQUIRES. The
    // September letter called the required $489.04 "your monthly
    // contribution" while the real rule was $125 every two weeks and one $125
    // had landed. A required amount is never a contribution.
    const rulesInto = (accountId: string | null): ContributionRuleFact[] =>
      accountId === null
        ? []
        : transferRuleRows
            .filter((r) => r.destination_account_id === accountId)
            .map((r) => contributionRuleFact(r.amount, r.cadence));
    // Same sign rule as computeGoalBalance, over the reviewed month only, and
    // never a future-dated row. A stated opening balance is a starting
    // position, not a deposit.
    const depositedInMonth = (accountId: string | null): number =>
      accountId === null
        ? 0
        : computeGoalBalance(
            goalTxData.filter(
              (r) => !r.is_opening_balance && r.date !== undefined && r.date >= monthStart && r.date < monthEnd
            ),
            accountId,
            today
          );
    // The same rules, with their dates, for monthReachedByRules: when the
    // household's own transfers bring a balance to its target.
    const reachRulesInto = (accountId: string | null): ReachRule[] =>
      accountId === null
        ? []
        : transferRuleRows
            .filter((r) => r.destination_account_id === accountId)
            .map((r) => {
              const fact = contributionRuleFact(r.amount, r.cadence);
              return {
                amount: fact.amount,
                cadence: fact.cadence,
                anchorDate: r.anchor_date ?? null,
                secondDay: r.second_day ?? null,
                effectiveFrom: r.effective_from ?? null,
              };
            });
    // Saved, remaining, and when the actual rules get there. The reach month is
    // left OUT when no helper can state it (no rule, a rule with no date, not
    // within 50 years): an estimate is never passed.
    const progressAtActual = (accountId: string | null, target: number, saved: number, targetDate: string | null) => {
      const reached = monthReachedByRules(target, saved, reachRulesInto(accountId), today);
      return {
        remaining: Math.max(0, Math.round((target - saved) * 100) / 100),
        ...(reached === null
          ? {}
          : {
              reachedAtActualContribution: reached,
              monthsLeftAtActualContribution: Math.max(0, monthsBetween(today, reached)),
              ...(targetDate ? { onTrackAtActualContribution: reached <= targetDate.slice(0, 7) } : {}),
            }),
      };
    };
    const goalFacts = computedGoals.map((g, i) => {
      const accountId = nonDebtGoals[i].accountId;
      return {
        name: g.name,
        targetAmount: g.targetAmount,
        savedSoFar: g.savedSoFar,
        targetDate: g.targetDate,
        fundedAlready: g.fundedAlready,
        pastDue: g.pastDue,
        // What the stated date needs each month. NOT what is contributed.
        requiredMonthly: g.monthlyContribution,
        // Whether requiredMonthly fits this month's surplus alongside the other
        // goals (evaluateGoals). It does not say the goal is on track.
        requiredFitsSurplus: g.onTrack,
        // The stated month when requiredMonthly fits; otherwise the month this
        // month's surplus would reach the target. Not a projection of the
        // actual contribution rule.
        estimatedDateAtRequired: g.estimatedDate,
        contributionRules: rulesInto(accountId),
        depositedThisMonth: depositedInMonth(accountId),
        ...progressAtActual(accountId, g.targetAmount, g.savedSoFar, g.targetDate),
      };
    });

    // ── Windfall awareness (Part B.4) ────────────────────────────────────────
    // An extra biweekly paycheque or a third mortgage payment this month is a
    // real, code-detected fact — passed to the review as something it MUST
    // acknowledge and MUST NOT present as a new run-rate ("July has three of
    // Lineu's paycheques — $2,749 extra that won't repeat in August").
    const { data: activeRecurringItems } = await supabase
      .from('recurring_items')
      .select('id, description, cadence, type')
      .eq('household_id', householdId)
      .in('type', ['income', 'expense'])
      .eq('active', true);
    const windfalls = detectWindfalls(
      allTxns.map((tx) => ({ recurring_item_id: tx.recurring_item_id ?? null, amount: tx.amount })),
      (activeRecurringItems ?? []) as { id: string; description: string; cadence: string; type: string }[]
    );

    // ── The Coaching Layer ────────────────────────────────────────────────────
    // Every figure below is code-computed (coachingHelpers.ts) and only ever
    // narrated by the review prompt — the AI is never asked to choose a
    // category or a priority. See coachingHelpers.ts for why a category with
    // no real overspend cannot reach this object at all, which is what makes
    // fabrication structurally impossible rather than merely discouraged.

    // 1. Prioritization: sinking-fund allocations + non-debt goals share one
    // ranked list. Debts stay OUT of it — a debt's monthly payment is either
    // already a committedTransfer above (already netted out of netCashFlow)
    // or not set up yet, in which case the debt card's own verdict already
    // surfaces that; folding it in here would pose a false choice between a
    // bill already being paid and a need that isn't.
    //
    // NEEDS THE PLAN ALREADY FUNDS ARE NOT NEEDS (2026-10-10). September's
    // letter proposed $258.85 "on top of what the plan already calls for"
    // toward the property-tax reserve, which a $425.52 monthly rule already
    // covered in full. A reserve whose shared buffer receives recurring
    // transfers at least equal to every fund's provision is dropped, and so
    // is a goal whose own rules meet its required monthly amount; a goal that
    // is only partly covered ranks on what it still lacks (monthlyShortfall).
    // A buffer that is only partly covered keeps its per-fund provisions: the
    // rule cannot be attributed to one fund rather than another.
    const bufferAccountIdForRules = sinkingFunds.find((sf) => sf.linked_account_id)?.linked_account_id ?? null;
    const totalProvisionForRules = sinkingFunds.reduce((sum, sf) => sum + Number(sf.monthly_provision ?? 0), 0);
    const reserveFundedInFull =
      totalProvisionForRules > 0 &&
      rulesInto(bufferAccountIdForRules).length > 0 &&
      monthlyShortfall(totalProvisionForRules, rulesInto(bufferAccountIdForRules)) === 0;
    const fundingNeeds: FundingNeed[] = [
      ...sinkingFunds
        .filter(() => !reserveFundedInFull)
        .filter((sf) => Number(sf.monthly_provision ?? 0) > 0)
        .map((sf) => ({
          kind: 'sinkingFundAllocation' as const,
          name: sf.name,
          monthlyProvision: Number(sf.monthly_provision),
          monthsUntilDue: computeSinkingFundUrgency(
            { dueMonth: sf.due_month ?? null, dueDay: sf.due_day ?? null },
            today
          ).monthsUntilDue,
          pastDue: false as const,
        })),
      ...computedGoals
        .map((g, i) => ({ g, rules: rulesInto(nonDebtGoals[i].accountId) }))
        .filter(({ g }) => !g.fundedAlready)
        // Covered in full by the household's own rules: not a need.
        .filter(({ g, rules }) => g.pastDue || g.monthlyContribution <= 0 || monthlyShortfall(g.monthlyContribution, rules) > 0)
        .map(({ g, rules }) => {
          const amountRemaining = Math.max(0, g.targetAmount - g.savedSoFar);
          return {
            kind: 'goal' as const,
            name: g.name,
            // What the goal still lacks each month once its own recurring
            // transfers are counted. A past-due goal has no valid $/month
            // against an already-passed target date — amountRemaining
            // substitutes purely as a ranking/tie-break magnitude here; the
            // review is only ever given amountRemaining/targetDate/pastDue
            // for a past-due item, never told to narrate this as a literal
            // monthly figure.
            monthlyShortfall: g.pastDue ? amountRemaining : monthlyShortfall(g.monthlyContribution, rules),
            monthsToTarget: g.hasTargetDate && g.targetDate ? monthsBetween(today, g.targetDate) : null,
            pastDue: g.pastDue,
            amountRemaining,
          };
        }),
    ];
    const rankedNeeds = rankFundingNeeds(fundingNeeds);
    const topNeed = rankedNeeds[0] ?? null;

    // 2a. Typical surplus: the 3 complete calendar months before this one,
    // windfalls netted back out so a one-time extra paycheque never inflates
    // what looks like ongoing room. historyRows' fixed 3-month/12-month-ahead
    // window (fetched above) covers this.
    const priorMonths = [1, 2, 3].map((n) => addMonthsToMonth(reviewMonthLabel, -n));
    const monthlyFigures = priorMonths.map((m) => {
      const mStart = `${m}-01`;
      const mEnd = `${addMonthsToMonth(m, 1)}-01`;
      const monthRows = historyRows.filter((r) => r.date >= mStart && r.date < mEnd);
      const monthTotals = computeMonthTotals(
        monthRows.map((r) => ({ amount: Number(r.amount), type: r.type, account_id: r.account_id })),
        accounts
      );
      const monthWindfalls = detectWindfalls(
        monthRows.map((r) => ({ recurring_item_id: r.recurring_item_id ?? null, amount: r.amount })),
        (activeRecurringItems ?? []) as { id: string; description: string; cadence: string; type: string }[]
      );
      const windfallExtra = monthWindfalls.reduce((sum, w) => sum + w.amount, 0);
      // A REAL MONTH HAS A CHEQUING ROW (2026-10-10). netCashFlow is computed
      // from chequing rows only, so a month holding nothing but card spend has
      // a "surplus" of exactly 0 that never happened. June 2026 had three card
      // rows and dragged 2be22642's typical surplus toward zero by a third.
      const hasRealData = monthRows.some((r) => r.account_id !== null && chequingIds.has(r.account_id));
      return { month: m, netCashFlow: monthTotals.netCashFlow, expenses: monthTotals.totalExpenses, windfallExtra, hasRealData };
    });
    // AVERAGE ONLY OVER MONTHS THAT HAPPENED (fixed 2026-08-08).
    //
    // computeTypicalSurplus divides by the number of months it is GIVEN, which
    // is correct. The bug was here: this passed a fixed three-element window,
    // so a household with one real month at +$900 and two months of nothing was
    // reported as "typically $300" — a threefold understatement of the only
    // month that exists, labelled typical.
    //
    // Harmless while three months of history was an eligibility requirement.
    // Once one completed month became enough, this understated the first review
    // of EVERY newly-onboarded household — precisely the November families the
    // reviews exist to retain.
    //
    // Second instance of this shape after the trailing variable average: an
    // empty period contributing 0 to a fixed-length mean. Audited 2026-08-08 —
    // this is the only remaining division of its kind in the coaching layer.
    //
    // insufficientHistory below deliberately still receives the FULL window: it
    // must keep detecting thin history in order to disclose it. Filtering its
    // input too would silence exactly the caveat that makes a one-month figure
    // honest.
    const monthsWithRealData = monthlyFigures.filter((m) => m.hasRealData);
    const typicalSurplusResult = computeTypicalSurplus(monthsWithRealData);
    const typicalSurplus = typicalSurplusResult?.typicalSurplus ?? null;
    // Fix 2 (2026-07-27): separate from fallbackApplies, which asks "is there
    // nothing anywhere to point to" — a household can have a real
    // sourceCategory/freedCapacityEvents AND still have most of its trailing
    // window be genuinely empty (e.g. recently onboarded). This lets the
    // review explain a conservative $0 honestly instead of staying silent.
    const insufficientHistory = computeInsufficientHistory(monthlyFigures);

    // 2b. Real over-target categories — card-envelope categories only (the
    // one place a family sets a real spending target today; there is no
    // chequing-side category target anywhere in the schema). Code selects AT
    // MOST ONE candidate (the largest overspend) — the AI is never given the
    // full list and never chooses; it only narrates the one already chosen.
    //
    // STATEMENT-CYCLE SCOPING (2026-10-10): each card's cycle labelled with
    // the REVIEWED month — the one that closes in it, the cycle the Cards page
    // shows under that month. Until 2026-10-10 this was "the cycle whose
    // window contains today", which on the 1st-of-month cron run is a cycle a
    // few days old, so a month's letter never saw that month's overspends.
    // Uses historyRows (a wide, already-fetched range) rather than allTxns
    // (scoped to exactly the calendar month, too narrow for a cycle that
    // starts in the previous month).
    const cardAccounts = accounts.filter((a) => a.type === 'credit_card');
    let cardFacts: CardCycleFacts[] = [];
    if (cardAccounts.length > 0) {
      const historyTxns = historyRows.map((t) => ({
        account_id: t.account_id as string,
        amount: t.amount,
        category_id: (t as { category_id?: string | null }).category_id ?? null,
        type: t.type,
        date: t.date,
        is_bridge: (t as { is_bridge?: boolean | null }).is_bridge ?? false,
      }));

      // Each card's reviewed cycle, as the Cards page shows it (goal, spent,
      // per-category plan and actual), judged against that cycle's plan — its
      // own, or carried forward (cardOverTarget.ts, the one read rule). The
      // letter's "cards" and the coaching source category are both derived
      // from these same facts, never computed twice.
      cardFacts = await loadCardCycleFacts(
        supabase,
        householdId,
        cardAccounts as { id: string; name: string; statement_close_day?: number | null }[],
        historyTxns,
        reviewMonthLabel,
        today
      );
    }
    const overTargetCategories = overTargetFromCardFacts(cardFacts);
    const sourceCategory = selectTopOverTargetCategory(overTargetCategories);

    // 2c. Freed-capacity events: the debt's own already-computed payoff date
    // (zero new math), plus any real installment series whose final,
    // already-materialized row is still in the future (each row carries its
    // own real date — no parsing of the cosmetic "N/Total" label needed,
    // only that it's non-null so a plain monthly-repeat row is excluded).
    const installmentSeries = groupInstallmentSeries(
      historyRows.map((r) => ({
        recurrence_id: (r as { recurrence_id?: string | null }).recurrence_id ?? null,
        installment_label: (r as { installment_label?: string | null }).installment_label ?? null,
        description: r.description ?? null,
        amount: r.amount,
        date: r.date,
      }))
    );
    const endingInstallments = installmentSeries.filter((s) => s.lastDate > today);
    const freedCapacityEvents = computeFreedCapacityEvents(computedDebtPayoff, endingInstallments);

    // 3. Ramping: never more than the top-ranked need requires, never more
    // than typical surplus (already net of committed transfers and
    // windfalls — genuinely uncommitted room). No cushion (founder decision,
    // 2026-07-25) — typicalSurplus already being an average is the margin.
    const startingContribution = computeStartingContribution(topNeed, typicalSurplus);

    // Meaning constraint, not fixed copy (founder decision, 2026-07-25): the
    // review prompt below requires the model to state plainly, in its own
    // words, that there's no clear extra room and to start small/revisit
    // later whenever this is true — never a vaguer instruction, never an
    // invented source.
    const fallbackApplies = coachingFallbackApplies({ typicalSurplus, sourceCategory, freedCapacityEvents });

    const coaching = {
      rankedNeeds,
      typicalSurplus,
      monthsOfHistoryUsed: typicalSurplusResult?.monthsUsed ?? 0,
      sourceCategory,
      freedCapacityEvents,
      startingContribution,
      fallbackApplies,
      insufficientHistory,
      // Fix (2026-07-28): borrowed cash is never real capacity — the same
      // binding contract typicalSurplus/startingContribution already honor
      // (netCashFlow, which both derive from, structurally excludes it).
      // Placed here rather than top-level "plan" so the constraint sits next
      // to the figures it constrains. reviewText previously had NO visibility
      // into this at all (plan never carried it) — see the COACHING rule
      // below for what the model may/may not say about it.
      totalBorrowed,
    };

    // ── Named review period (Part B.5) ───────────────────────────────────────
    // The AI must never guess or default to a different month than the one
    // actually reviewed — it's a computed input, not something to infer.
    const reviewMonthName = new Date(monthStart + 'T00:00:00').toLocaleDateString(
      locale === 'fr' ? 'fr-CA' : 'en-CA',
      { month: 'long', year: 'numeric' }
    );

    // ── Income lines: aggregate by source for AI context ─────────────────────
    // (e.g. Lineu bi-weekly appears 3× in July → one aggregated line: $8,247)
    const incomeBySource = new Map<string, number>();
    for (const tx of allTxns) {
      if (tx.type === 'income') {
        const label = tx.description ?? 'Income';
        incomeBySource.set(label, round((incomeBySource.get(label) ?? 0) + Number(tx.amount)));
      }
    }
    const incomeLines = Array.from(incomeBySource.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    // ── Expense lines: chequing only, aggregate by description ───────────────
    // Mirrors computeMonthTotals — avoids card/bridge double-count.
    const expenseByLabel = new Map<string, number>();
    for (const tx of allTxns) {
      if (
        tx.type === 'expense' &&
        tx.account_id !== null &&
        chequingIds.has(tx.account_id)
      ) {
        const label = tx.description ?? 'Expense';
        expenseByLabel.set(label, round((expenseByLabel.get(label) ?? 0) + Number(tx.amount)));
      }
    }
    const expenseLines = Array.from(expenseByLabel.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    // ── Assemble calculated object ────────────────────────────────────────────
    const calculated = {
      income:   { detected: incomeLines.length > 0,  lines: incomeLines,  total: incomeTotal  },
      expenses: { detected: expenseLines.length > 0, lines: expenseLines, total: expenseTotal },
      netCashFlow,
      excludedLines: [],
      confidence: 'high',
    };

    const monthlyBudget = assembleCalculatedBudget(calculated);

    const aiContext =
      `The reviewed period is ${reviewMonthName} (${reviewMonthLabel}) — refer to it by this exact name, never a different month.\n` +
      `Net cash flow: $${netCashFlow}/month ` +
      `(income $${incomeTotal}, expenses $${expenseTotal}, savings $${totalSavings}, debt payments $${totalDebtPayments})\n` +
      `Accounting model: net = income − expenses − savings − debt payments (savings = transfers to a ` +
      `savings/TFSA/RRSP/reserve-fund account; debt payments = transfers to a debt account — paying down a ` +
      `credit line is not saving, keep the two separate in the narration)\n` +
      (totalBorrowed > 0
        ? `Borrowed this month: $${totalBorrowed}, drawn from a credit line. This is debt, NOT income and NOT ` +
          `savings — it is already excluded from every figure above. Never describe this month as having more ` +
          `income, savings, or surplus because of it; if you mention the household's cash position, disclose that ` +
          `part of it was borrowed.\n`
        : '') +
      `All figures are ACTUAL ${reviewMonthLabel} ledger — computed from materialized transactions, ` +
      `NOT from planned budgets or per-period recurring amounts.\n` +
      `Income lines: ${JSON.stringify(incomeLines)}\n` +
      `Expense lines (chequing, avoids card double-count): ${JSON.stringify(expenseLines)}\n` +
      `Their sinking funds (already set up, or none): ${JSON.stringify(sinkingFunds)}\n` +
      `Their goals — ALREADY verified, do not recompute or contradict these numbers, just narrate them naturally where relevant. "requiredMonthly" is what the target date needs each month, NEVER what the household contributes; what they actually put in is "contributionRules" (amount and frequency) and "depositedThisMonth": ${JSON.stringify(goalFacts)}\n` +
      `Their debt payoff — ALREADY verified (null means no debt evident or nothing computable), do not recompute or contradict: ${JSON.stringify(computedDebtPayoff)}\n` +
      `Their recurring contributions and debt payments (or none) — these are already deducted inside the ` +
      `savings figure and net cash flow above, NOT extra discretionary room: ${JSON.stringify(committedTransfers)}\n` +
      `Windfalls this month (or none) — a recurring item that landed MORE times than its usual cadence this ` +
      `specific month (e.g. a third biweekly paycheque instead of two). Each one MUST be acknowledged as a ` +
      `one-time timing event, MUST NOT be treated as a new ongoing run-rate: ${JSON.stringify(windfalls)}`;

    // ── Generate plan (AI interprets verified numbers only) ──────────────────
    // The AI may NEVER instantiate structured objects here either — same hard
    // gate as api/plan/route.ts. Sinking funds come from the real sinking_funds
    // table (or none); goals/debtPayoff come from real goal accounts via
    // evaluateGoals()/computeDebtPayoff() (or none). This feeds the ongoing
    // monthly review — the single most important retention surface — so it
    // must be constitutionally incapable of inventing a fund, goal, or debt
    // plan the family never set up.
    const categoryList = SEED_CATEGORIES.join(', ');
    const planPrompt =
      `You are Phare, a financial planning system for Canadian households. The numbers below are VERIFIED — ` +
      `calculated from the household's ledger. Do not change or recalculate them.\n\n` +
      `${aiContext}\n\n` +
      `Write ALL text in ${lang}.\n\n` +
      `Return ONLY valid JSON:\n` +
      `{"lineClassifications":[{"label":"","category":"","isFixed":true}],"topRecommendation":""}\n\n` +
      `Rules:\n` +
      `- All descriptions and topRecommendation text in ${lang}.\n` +
      `- lineClassifications: for EACH expense line label provided, return an object with:\n` +
      `  - "label": the exact expense line label as given\n` +
      `  - "category": which ONE of these fits best: ${categoryList}. Use the English category name exactly as written here.\n` +
      `  - "isFixed": true if it is a fixed recurring bill paid every month; false if variable day-to-day spending.\n` +
      `- Classify income lines too: category "Income", isFixed true.\n` +
      `- Do NOT output any reserve funds, goals, or debt payoff as structured data — there is no field for them in the JSON above. If you want to suggest one, put it in topRecommendation as a suggestion phrased as a suggestion ("Consider…"), never as a fund/goal/debt-plan they already have and never with a monthly amount presented as theirs.\n` +
      `- Their goals (if any) are already evaluated (contribution, on-track verdict, and dates are all real, verified numbers) — do not invent or restate any of those figures anywhere.\n` +
      `- DEBT PAYOFF: if topRecommendation mentions the debt's own required monthly payment amount, you MUST write the literal placeholder ${DEBT_PAYMENT_PLACEHOLDER} in its place — never type a dollar figure for it yourself, under any circumstance, in any language or currency format. You may still describe timing/urgency around it in your own words (e.g. "with the credit line's ${DEBT_PAYMENT_PLACEHOLDER}/month payment, this month's extra room could go toward it").\n` +
      `- Their recurring contributions and debt payments (if any) are already subtracted from the net cash flow figure above — if you mention one, say it's already accounted for (e.g. "your $500/mo RRSP contribution is already counted"), never present it as new discretionary room and never double-count it against a separate suggestion.\n` +
      `- Vocabulary: never write "code", "computed in code", or similar internal/technical phrasing — a reader must never see the word "code" at all. An estimated date or figure should read as a plain estimate (e.g. "estimated: March 2027"), never "code-estimated". Never call a figure "budgeted" unless the household actually set that budget themselves — a computed or projected amount (including a card/bridge payment total) should read as "expected", not "budgeted".\n` +
      `- Canadian context: RRSP, RESP, TFSA, CESG.\n` +
      `- If net cash flow is negative, topRecommendation must address that first.\n` +
      `- topRecommendation: one specific sentence with a dollar amount.`;

    const planMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: planPrompt }],
    });

    const planText = planMessage.content[0].type === 'text' ? planMessage.content[0].text : '';
    const aiPart = JSON.parse(planText.replace(/```json|```/g, '').trim());

    // Sinking funds are DB-derived (real rows) or empty — never AI-invented.
    // aiPart is not consulted for them. Every row now shares ONE cash buffer
    // (Build 4 Part A, 2026-07-21 revision) — no family runs seven separate
    // sinking accounts — so the per-fund entries stay display-only
    // (name/amounts/due month) and the one real fundedAlready signal lives
    // on sinkingFundBuffer below, computed once from whichever account any
    // row is linked to (they're all the same account, by construction).
    const finalSinkingFunds = sinkingFunds.map((sf) => ({
      name: sf.name,
      annualAmount: Number(sf.annual_amount),
      monthlyProvision: Number(sf.monthly_provision),
      dueMonth: sf.due_month ?? '',
    }));
    const bufferAccountId = sinkingFunds.find((sf) => sf.linked_account_id)?.linked_account_id ?? null;
    const bufferBalance = bufferAccountId
      ? computeGoalBalance(goalTxData, bufferAccountId, today)
      : 0;
    const totalAnnualReserve = round(sinkingFunds.reduce((sum, sf) => sum + Number(sf.annual_amount ?? 0), 0));
    // The reserve's progress (2026-10-10): its balance, the household's own
    // transfers into it and what landed this month, and when those transfers
    // bring it to every fund's annual amount. September's letter said the
    // reserve was "in place and working as planned" in a month when nothing
    // was deposited.
    const sinkingFundBuffer = {
      fundedAlready: bufferBalance > 0,
      totalMonthlyProvision: Math.round(
        sinkingFunds.reduce((sum, sf) => sum + Number(sf.monthly_provision ?? 0), 0) * 100
      ) / 100,
      ...(bufferAccountId === null
        ? {}
        : {
            balance: bufferBalance,
            totalAnnualAmount: totalAnnualReserve,
            contributionRules: rulesInto(bufferAccountId),
            depositedThisMonth: depositedInMonth(bufferAccountId),
            ...progressAtActual(bufferAccountId, totalAnnualReserve, bufferBalance, null),
          }),
    };

    const classMap = new Map<string, { category: string; isFixed: boolean }>();
    for (const lc of (aiPart.lineClassifications ?? [])) {
      if (lc?.label) {
        classMap.set(lc.label.trim().toLowerCase(), {
          category: lc.category || 'Unexpected',
          isFixed: !!lc.isFixed,
        });
      }
    }

    const deduped = dedupeSinkingFunds(monthlyBudget.categories, finalSinkingFunds);
    const classifiedCategories = deduped.map((cat: Category) => {
      const cls = classMap.get(cat.name.trim().toLowerCase());
      return {
        ...cat,
        isFixed: cat.type === 'income' ? true : (cls?.isFixed ?? false),
      };
    });

    // Every line label in the payload — real, user-facing names that the
    // token-leak exemption below must know about.
    const retainedCategoryLineLabels = classifiedCategories.map((c) => c.name);

    // ── The month, where its savings went, and the month before ─────────────
    const accountNameById = new Map(accounts.map((a) => [a.id as string, a.name as string]));
    const monthFacts = {
      income: incomeTotal,
      expenses: expenseTotal,
      savings: totalSavings,
      debtPayments: totalDebtPayments,
      borrowed: totalBorrowed,
      netCashFlow,
      result: netCashFlow >= 0 ? ('surplus' as const) : ('deficit' as const),
    };
    // computeMonthTotals' own partition of the savings figure, named. A null
    // name is a destination that can no longer be named ("Other").
    const savingsLines = savingsByDestination.map((line) => ({
      name: line.accountId ? (accountNameById.get(line.accountId) ?? null) : null,
      amount: line.amount,
    }));
    const cardSpend = round(cardFacts.reduce((sum, c) => sum + c.spent, 0));
    const previousCardSpend = round(cardFacts.reduce((sum, c) => sum + c.previousCycleSpent, 0));
    const previous = monthlyFigures[0];
    // Only a month that happened (a chequing row) is compared against.
    const previousMonthFacts = previous && previous.hasRealData
      ? {
          name: new Date(`${previous.month}-01T00:00:00`).toLocaleDateString(
            locale === 'fr' ? 'fr-CA' : 'en-CA',
            { month: 'long', year: 'numeric' }
          ),
          expenses: previous.expenses,
          expensesChange: round(expenseTotal - previous.expenses),
          ...(cardFacts.length > 0
            ? { cardSpend: previousCardSpend, cardSpendChange: round(cardSpend - previousCardSpend) }
            : {}),
        }
      : null;

    // ── The month ahead, as the Cash Timeline shows it ──────────────────────
    const chequingAccount = accounts.find((a) => a.type === 'chequing');
    const monthAhead: MonthAheadFacts | null = chequingAccount
      ? await loadMonthAhead({
          supabase,
          householdId,
          chequingId: chequingAccount.id as string,
          cards: cardAccounts.map((a) => ({
            id: a.id as string,
            name: a.name as string,
            payment_day: ((a as { payment_day?: number | null }).payment_day ?? null),
            statement_close_day: (a.statement_close_day ?? null) as number | null,
          })),
          month: addMonthsToMonth(reviewMonthLabel, 1),
          today,
        })
      : null;

    const cards = cardFacts.map((c) => cardLetterFacts(c, locale));

    // ── THE LETTER'S PAYLOAD (2026-10-10) ────────────────────────────────────
    // Every number below is code-computed from the shared helpers; the letter
    // may restate them and nothing else (the figure guard enforces it).
    // "budgeted" is gone: the line amounts are this month's actuals and are
    // named so.
    const letterPayload = {
      reviewMonth: reviewMonthName,
      month: monthFacts,
      savingsByDestination: savingsLines,
      recurringTransfers: committedTransfers,
      previousMonth: previousMonthFacts,
      cards,
      monthAhead,
      incomeLines: classifiedCategories
        .filter((c) => c.type === 'income')
        .map((c) => ({ name: c.name, actual: c.budgeted })),
      expenseLines: classifiedCategories
        .filter((c) => c.type !== 'income')
        .map((c) => ({ name: c.name, actual: c.budgeted, isFixed: c.isFixed })),
      sinkingFunds: finalSinkingFunds,
      sinkingFundBuffer,
      // Code-computed from real goal accounts — never AI-emitted.
      debtPayoff: computedDebtPayoff,
      goals: goalFacts,
      windfalls,
      // The Coaching Layer — entirely code-computed (coachingHelpers.ts): the
      // AI only narrates this, it never reorders rankedNeeds, never picks a
      // different sourceCategory, never invents a freedCapacityEvent or a
      // starting amount above startingContribution.
      coaching,
      // FIX 1 (2026-07-27): topRecommendation is planPrompt's free text — the
      // debt's own monthly payment figure inside it is never trusted as
      // AI-authored digits (topRecommendationHelpers.ts).
      // FIX 4 (2026-07-28): never let a real credit-line draw get labeled as
      // surplus/extra/income.
      topRecommendation: enforceBorrowedCashFraming(
        enforceDebtFigureInTopRecommendation(
          aiPart.topRecommendation ?? '',
          computedDebtPayoff,
          locale
        ),
        totalBorrowed,
        locale
      ),
    };

    // ── Generate review (blocking) ────────────────────────────────────────────
    // Part B hardening (2026-07-19), against four real failures in the
    // founder's July 17 review: a wrong month name, a windfall paycheque
    // narrated as a new run-rate, an on-track claim beyond what evaluateGoals
    // actually verified, and prose arithmetic that didn't match its own parts.
    //
    // KEEP THIS LIST IN SYNC WITH reviewPrompt's OWN TEXT BELOW (2026-07-28):
    // every illustrative single-brace example token reviewPrompt's hard rules
    // use must be listed here too, or a leaked one goes undetected.
    const REVIEW_PROMPT_ILLUSTRATIVE_TOKENS = ['name', 'month', 'need', 'freesOn'] as const;

    const reviewPrompt =
      `You are Phare, a financial planning system for Canadian households. Write this household's monthly review in ${lang}.\n\n` +
      `Their plan:\n${JSON.stringify(letterPayload)}\n\n` +
      `Write up to FOUR paragraphs. Specific numbers. One clear recommendation. Plain language. ` +
      `It must feel like a letter from a trusted financial advisor, not a report.\n\n` +
      `Good tone: "${reviewMonthName} closed with a surplus, but two of your cards ran past the goals you set."\n` +
      `Bad tone: "Based on a comprehensive analysis of your financial data..."\n\n` +
      `Open with how the month actually went, as "month.result" and "cards" say it: do not open with praise ` +
      `for a month that ran a deficit or went over its card goals. End with the one thing to do this month. ` +
      `Write ONLY the review text, no preamble, no headings.\n\n` +
      `Hard rules — every one of these caused a real, published mistake before, do not repeat any of them:\n` +
      `- The reviewed month is "reviewMonth" above: ${reviewMonthName}. Refer to it by exactly this name. ` +
      `Never name a different month (not last month, not a guess, not an example from your own training) — ` +
      `this field is the only source of truth for which period you are reviewing.\n` +
      `- NO ARITHMETIC: every number in "plan" is already fully computed. You may only restate a figure exactly ` +
      `as given — you may NOT add, subtract, multiply, divide, average, round, or otherwise derive any number that ` +
      `is not already present as a single value above. If no single given figure says what you want to say, don't ` +
      `say it with a number. Write every dollar figure exactly as given, cents included when it has cents ` +
      `("$1,157.77", never "about $1,158" or "roughly $1,200").\n` +
      `- NO PERCENTAGES: never write a percentage or a ratio. Every number in the letter is a dollar figure ` +
      `from the plan, a date, or a count of months from it.\n` +
      `- CARDS AND CATEGORIES: you may name any card in "cards" and any category in a card's "topOverspends", ` +
      `with their own figures exactly as given (goal, spent, overGoalBy, previousCycleSpent, spentChange; plan, ` +
      `actual, over, previousActual, change). Write each name exactly as given. Never name any other card or ` +
      `spending category. A card with "open": true has a statement cycle that has not closed yet: it and its ` +
      `categories are "running ahead of the goal so far", never "over goal" or "went over". A card with no ` +
      `"overGoalBy" did not go past its goal; a card whose "goal" is null has no goal.\n` +
      `- THE MONTH AHEAD: "monthAhead" is the next month's chequing balance as dated today: its lowest point and ` +
      `the day it is reached, and whether any day is dated below zero. If it is null, say nothing about next ` +
      `month's balance with a number.\n` +
      `- ON-TRACK CLAIMS: for any goal or debt, you may state its status only by directly restating what "goals"/` +
      `"debtPayoff" already say — never assert or imply "on track", "behind", or "funded" beyond exactly what ` +
      `those fields say for that specific goal. "onTrackAtActualContribution" (present only when it can be ` +
      `stated) says whether the household's own recurring transfers reach the target by its date; ` +
      `"reachedAtActualContribution" is the month they get there. "requiredFitsSurplus" only means the required ` +
      `amount would fit this month's surplus; it is NOT "on track".\n` +
      `- CONTRIBUTIONS: a goal's "requiredMonthly" is what its target date needs each month. NEVER call it a ` +
      `contribution, never say it is "in motion", "set up" or "being saved". What the household actually ` +
      `contributes is "contributionRules" (each an amount and a frequency, e.g. "$125 every two weeks") and what ` +
      `landed this month is "depositedThisMonth". If "contributionRules" is empty, they have no recurring ` +
      `contribution to that goal. The same holds for "sinkingFundBuffer".\n` +
      `- ZERO-BALANCE GOALS: for any goal whose "savedSoFar" is 0 and "fundedAlready" is false, write about it as ` +
      `forward-looking — never as if saving is already underway.\n` +
      `- RESERVE FUNDS: every entry in "sinkingFunds" shares ONE cash buffer — "sinkingFundBuffer.fundedAlready" is ` +
      `the single real signal for ALL of them (never treat one fund as funded and another as not; there is only one ` +
      `account). When fundedAlready is false — meaning the buffer hasn't been started yet — describe each fund as a ` +
      `plan or recommendation only: "your plan sets aside $X/month for {name}" or "recommended: $X/month toward ` +
      `{name} so the {month} bill doesn't catch you off guard." NEVER say "you're setting aside $X/month" or ` +
      `"you're saving $X/month" for any fund unless sinkingFundBuffer.fundedAlready is true, and never say the ` +
      `reserve is "working as planned" or "in place" in a month whose "sinkingFundBuffer.depositedThisMonth" is 0. ` +
      `You may mention "sinkingFundBuffer.totalMonthlyProvision" as the combined monthly amount across every fund, ` +
      `but never sum the individual funds yourself — that figure is already given. "monthlyProvision"/` +
      `"totalMonthlyProvision" are the plan's OWN established figures and may always be restated using the ` +
      `phrasing above regardless of "coaching.startingContribution" — that cap governs a different thing ` +
      `entirely: see COACHING below for exactly what it bounds.\n` +
      `- WINDFALLS: if "windfalls" is non-empty, you MUST explicitly acknowledge each one by name and amount, ` +
      `framed as a one-time timing event that will NOT repeat next month (e.g. "${reviewMonthName} included a ` +
      `third biweekly paycheque — $X extra that won't repeat next month") — never described as a new normal ` +
      `income/expense level going forward.\n` +
      `- VOCABULARY: never write "code", "computed in code", or similar internal/technical phrasing anywhere — ` +
      `the reader must never see the word "code". An estimated date or figure reads as a plain estimate (e.g. ` +
      `"estimated: March 2027"), never "code-estimated" or "code-computed". A projected or computed amount ` +
      `(including a card/bridge payment total) reads as "expected", never "budgeted" — reserve "budgeted" only ` +
      `for a figure the household actually set as a budget themselves.\n` +
      `- COACHING — WHERE THE MONEY COMES FROM: "coaching" is the ONLY source of any funding-priority ` +
      `suggestion. Its "rankedNeeds" is already in the correct priority order — restate that order, ` +
      `never re-rank it yourself and never suggest funding anything not in this list. A need the household's own ` +
      `recurring transfers already cover in full is not in this list, on purpose: never suggest putting more toward ` +
      `it. A goal's "monthlyShortfall" is what it still lacks each month after its own transfers. SCOPE OF THE CAP: ` +
      `"coaching.startingContribution" bounds only a DISCRETIONARY "extra"/"additional" amount YOU might suggest ` +
      `directing toward a need ON TOP OF what the plan already calls for — it does NOT cap restating a reserve ` +
      `fund's own "monthlyProvision" or a goal's own "requiredMonthly" verbatim, named as what it is (those are ` +
      `the plan's existing, already-established figures, governed by the RESERVE FUNDS and ON-TRACK CLAIMS rules ` +
      `above, not by this cap; e.g. "your plan calls for $X/month toward Property Tax" is always fine to state ` +
      `even when startingContribution is 0 — that number is not a new suggestion). What the cap DOES bound: ` +
      `"coaching.startingContribution" is the most you may ever propose applying as NEW, additional, ` +
      `on-top-of-plan money — never recommend a larger discretionary figure than that. ` +
      `"coaching.sourceCategory", when non-null, is the largest overspend across the cards; you may offer it as ` +
      `one place the money could come from — phrase it as an option the household can use if they choose, ` +
      `never a command like "cut back on X." If "coaching.sourceCategory.open" is true, its card's cycle has not ` +
      `closed: say it is "running ahead of its target so far". If "coaching.freedCapacityEvents" is non-empty, you ` +
      `may describe growth only from those exact events (their own label/amount/freesOn) — e.g. "once X clears in ` +
      `{freesOn}, that $Y/month could go toward {need}" — never invent a schedule or a growth event not in this ` +
      `list. If "coaching.fallbackApplies" is true, you must state plainly, in your own natural words, that there is no ` +
      `clear extra room right now and that starting small / revisiting later is the move — never substitute a ` +
      `vaguer instruction like "look at your spending," and never name a category or event to fill the gap. If ` +
      `"coaching.insufficientHistory" is true, you may state plainly, in your own words, that a starting figure is ` +
      `conservative because there isn't a full trailing history to draw on yet — this is a DIFFERENT condition ` +
      `from fallbackApplies; never invent a larger or different number to fill the gap either way. BORROWED CASH: ` +
      `"coaching.totalBorrowed" is real money drawn from a credit line this month (0 means none) — it is NOT ` +
      `income, NOT savings, and NOT part of any surplus/capacity figure above (netCashFlow/typicalSurplus already ` +
      `exclude it entirely). If it is non-zero, you may disclose it honestly (e.g. "$X of this month's cash was ` +
      `borrowed from a credit line") but must NEVER describe it as surplus, extra, income, or savings, and must ` +
      `never add it into or imply it inflates any capacity figure you state. TONE: ` +
      `never write "cut", "cut back", "reduce your spending on", "wasteful", "unnecessary", "frivolous", ` +
      `"shouldn't", "you need to stop", or "overspent" (say "ran higher than your own target" instead); never imply ` +
      `a category is frivolous or that the household is failing; no category (groceries, childcare, health included) ` +
      `is ever singled out as more discretionary than another — the voice is a humble coach offering an option, not ` +
      `an auditor issuing a verdict.\n` +
      `- NO INVENTED TARGETS: never describe any category, fund, or line as having a "budget," "target," or ` +
      `"limit" unless one is explicitly present in the given data for that specific item (a card's "goal", a ` +
      `"topOverspends" entry's "plan"). An income or expense line has an actual amount only — never "within ` +
      `budget," "on budget," or "over budget."`;

    async function generateReviewText(): Promise<string> {
      const reviewMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: reviewPrompt }],
      });
      return reviewMessage.content[0].type === 'text' ? reviewMessage.content[0].text : '';
    }

    // A household's own fund/goal/category name could coincidentally BE one
    // of the illustrative token strings (e.g. a fund literally named "{name}")
    // — that's real text, not a leak (Codex finding 5i).
    const realEntityNames = [
      ...sinkingFunds.map((sf) => sf.name),
      ...computedGoals.map((g) => g.name),
      ...(debtGoalLine ? [debtGoalLine.name] : []),
      ...(sourceCategory ? [sourceCategory.categoryName] : []),
      ...retainedCategoryLineLabels,
    ];

    // NAMES (2026-10-10): every category this household has, and the ones the
    // payload's "cards" carry. Replaces the category-sourcing check, which
    // allowed one category near a few phrases. Card names are not listed:
    // every credit card is in "cards", so a card name is always allowed.
    const { data: categoryRows, error: categoryErr } = await supabase
      .from('categories')
      .select('name, name_fr')
      .eq('household_id', householdId);
    if (categoryErr) throw new Error(`categories read failed: ${categoryErr.message}`);
    // Every way the household's categories are written, in both languages —
    // including the seed translation the Cards page shows when name_fr is empty.
    const knownNames = [
      ...((categoryRows ?? []) as { name: string | null; name_fr: string | null }[])
        .filter((c): c is { name: string; name_fr: string | null } => typeof c.name === 'string' && c.name.length > 0)
        .flatMap((c) => [c.name, c.name_fr, categoryDisplayName(c, 'fr')])
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    ];
    const payloadNames = cards.flatMap((c) => [c.name, ...c.topOverspends.map((o) => o.category)]);

    type Violation = { figures: string[]; names: string[]; borrowed: boolean; token: boolean };
    function checkReviewGuards(text: string): Violation {
      return {
        figures: checkLetterFigures(text, letterPayload).offending,
        names: findNamesNotInPayload(text, knownNames, payloadNames),
        borrowed: totalBorrowed > 0 && enforceBorrowedCashFraming(text, totalBorrowed, locale) !== text,
        // Same condition, two shapes of leak: a real {{...}} template token
        // and reviewPrompt's own single-brace illustrative examples echoed
        // verbatim.
        token: containsUnsubstitutedToken(text) || containsIllustrativeTokenLeak(text, REVIEW_PROMPT_ILLUSTRATIVE_TOKENS, realEntityNames),
      };
    }
    const anyViolation = (v: Violation) => v.figures.length > 0 || v.names.length > 0 || v.borrowed || v.token;

    function violatedReasons(v: Violation): string[] {
      const reasons: string[] = [];
      if (v.borrowed) reasons.push('borrowed_cash');
      if (v.token) reasons.push('token_leak');
      if (v.figures.length > 0) reasons.push('figures');
      if (v.names.length > 0) reasons.push('names');
      return reasons;
    }

    let reviewText = await generateReviewText();
    const firstAttemptViolation = checkReviewGuards(reviewText);

    if (anyViolation(firstAttemptViolation)) {
      reviewText = await generateReviewText();
      const retryViolation = checkReviewGuards(reviewText);

      // A FIGURE OR A NAME THE PAYLOAD DOES NOT HOLD FAILS VISIBLY (2026-10-10).
      // Regenerated once; if the second letter still fails, nothing is saved —
      // the caller gets the error, and an event records the household, the
      // month and exactly what failed, so it can be found by a query. A
      // letter with a figure code never computed is never persisted.
      if (retryViolation.figures.length > 0 || retryViolation.names.length > 0) {
        void logEvent(supabase, householdId, userId, 'review_guard_failed', {
          month: reviewMonthLabel,
          kind: 'monthly_review',
          figures: retryViolation.figures,
          names: retryViolation.names,
          firstAttempt: { figures: firstAttemptViolation.figures, names: firstAttemptViolation.names },
        });
        throw new LetterGuardError(retryViolation.figures, retryViolation.names);
      }

      // Otherwise, priority when the retry still fails — stated as a rule:
      // borrowed-cash (materially dangerous — debt described as spendable
      // money) > a leaked template token (a visibly broken artifact).
      let outcome: 'retry_passed' | 'fallback_borrowed' | 'fallback_token';
      if (retryViolation.borrowed) {
        reviewText = enforceBorrowedCashFraming(reviewText, totalBorrowed, locale);
        outcome = 'fallback_borrowed';
      } else if (retryViolation.token) {
        reviewText = buildFallbackReviewText(reviewMonthName, locale);
        outcome = 'fallback_token';
      } else {
        outcome = 'retry_passed';
      }

      // Visibility (2026-07-28): how often the model actually violates these
      // rules.
      void logEvent(supabase, householdId, userId, 'review_text_guard_retried', {
        triggeredBy: violatedReasons(firstAttemptViolation),
        outcome,
      });
    }
  return { topRecommendation: letterPayload.topRecommendation, reviewText };
}
