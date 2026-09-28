import {
  afterSaveOutcome,
  buildCalculatedFromFormLines,
  buildSemimonthlyAnchor,
  DEFAULT_HOUSEHOLD_TIMEZONE,
  businessToday,
  isCalendarDate,
  onboardingErrorKind,
  openingAnchorValue,
  parseAmountInput,
  runPlausibilityGuard,
  validateNextPayDate,
  validateSemimonthlyDays,
  type AfterSaveOutcome,
  type FormLineInput,
  type IncomeFrequency,
  type PlausibilityResult,
} from '@phare/core';
import { ApiError, messageKeyFor } from './apiErrors';
import type { Getter } from './timelineLoader';
import type { AccountsResponse, TimezoneResponse } from './timeline';
import type { Locale } from '../i18n/catalog';

// ---------------------------------------------------------------------------
// Manual onboarding on mobile: the web upload page's manual lane, same order,
// same routes, same decisions (which live in @phare/core).
//
//   form → plausibility → accounts → /api/plan → /api/review-stream?stream=0
//        → /api/save-plan → (only after a save) /api/anchors → pay dates
//
// WHAT MOBILE NEVER DOES, each enforced here rather than in a screen:
//   - send confirmReplace: true. A household with prior data gets
//     needsConfirmation back; replacing data stays on the web in V1.
//   - retry /api/plan by itself. Each call spends one of the household's
//     monthly generations; a retry is the person's decision, not a loop's.
//   - anchor before the save succeeded.
//   - read an amount with parseFloat. Every amount goes through
//     parseAmountInput first, because buildCalculatedFromFormLines uses
//     parseFloat and an fr-CA keypad's "1 234,56" would otherwise be 1.
// ---------------------------------------------------------------------------

export type Poster = <T>(path: string, body: unknown) => Promise<T>;
export type Patcher = <T>(path: string, body: unknown) => Promise<T>;

// ── The form ────────────────────────────────────────────────────────────────

export type DraftLine = { label: string; amount: string; frequency: IncomeFrequency };

export type FormProblem =
  | { kind: 'noIncome' }
  | { kind: 'labelMissing'; section: 'income' | 'expenses'; index: number }
  | { kind: 'amountInvalid'; section: 'income' | 'expenses'; index: number }
  | { kind: 'statedInvalid' };

export const FREQUENCIES: IncomeFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

export function emptyLine(): DraftLine {
  return { label: '', amount: '', frequency: 'monthly' };
}

/**
 * One section's lines → the canonical FormLineInput[] the core builder reads.
 *
 * A fully blank line is ignored (the form starts with one). A half-filled
 * line is REFUSED: the web builder silently drops a line with an amount and
 * no label, and a household would lose a real figure without being told.
 * Amounts are re-written in canonical form ("1234.56") so the builder's
 * parseFloat reads exactly what parseAmountInput read.
 */
function normaliseSection(
  lines: DraftLine[],
  section: 'income' | 'expenses'
): { ok: true; lines: FormLineInput[] } | { ok: false; problem: FormProblem } {
  const out: FormLineInput[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const label = line.label.trim();
    const rawAmount = line.amount.trim();
    if (!label && !rawAmount) continue;
    if (!label) return { ok: false, problem: { kind: 'labelMissing', section, index } };
    const amount = parseAmountInput(rawAmount);
    if (amount === null || amount <= 0) return { ok: false, problem: { kind: 'amountInvalid', section, index } };
    out.push({ label, amount: String(amount), frequency: line.frequency });
  }
  return { ok: true, lines: out };
}

export type BuiltForm = {
  calculated: ReturnType<typeof buildCalculatedFromFormLines>;
  guard: PlausibilityResult;
};

export function buildForm(
  income: DraftLine[],
  expenses: DraftLine[],
  statedCombinedAnnual: string
): { ok: true; value: BuiltForm } | { ok: false; problem: FormProblem } {
  const inc = normaliseSection(income, 'income');
  if (!inc.ok) return inc;
  const exp = normaliseSection(expenses, 'expenses');
  if (!exp.ok) return exp;
  if (inc.lines.length === 0) return { ok: false, problem: { kind: 'noIncome' } };

  // Optional. Blank is "not given"; anything typed must read exactly.
  let stated: number | null = null;
  if (statedCombinedAnnual.trim()) {
    stated = parseAmountInput(statedCombinedAnnual);
    if (stated === null || stated <= 0) return { ok: false, problem: { kind: 'statedInvalid' } };
  }

  const calculated = buildCalculatedFromFormLines(inc.lines, exp.lines);
  const guard = runPlausibilityGuard({
    computedMonthlyIncome: calculated.income.total,
    netCashFlow: calculated.netCashFlow,
    expenseLines: calculated.expenses.lines,
    statedCombinedAnnual: stated,
  });
  return { ok: true, value: { calculated, guard } };
}

// ── The accounts step ───────────────────────────────────────────────────────

/** 0 to 3 cards, as the web offers. */
export const CARD_COUNTS = [0, 1, 2, 3] as const;

/** Named cards, blank names replaced by the localised default, as web does. */
export function resolveCardNames(count: number, names: string[], defaultName: (n: number) => string): string[] {
  return Array.from({ length: count }, (_, i) => (names[i]?.trim() || defaultName(i + 1)).trim());
}

/**
 * The opening balance as typed → the canonical string openingAnchorValue
 * reads, or a refusal. Blank is fine: "not now". Negative is fine: an
 * overdrawn account is a real balance (though the iOS decimal pad has no
 * minus key). Anything unreadable is refused HERE, visibly, so the silent
 * skip inside openingAnchorValue can never be reached from mobile.
 */
export function normaliseOpeningBalance(raw: string): { ok: true; value: string } | { ok: false } {
  if (!raw.trim()) return { ok: true, value: '' };
  const parsed = parseAmountInput(raw);
  if (parsed === null) return { ok: false };
  return { ok: true, value: String(parsed) };
}

// ── The server calls ────────────────────────────────────────────────────────

/** The plan is the server's; mobile carries it to save-plan untouched. */
export type Plan = Record<string, unknown>;

export type ReviewOutcome =
  | { ok: true; text: string }
  /** messageKey: what to tell the person; the plan is still saved. */
  | { ok: false; messageKey: string; resetsOn: string | null };

export type SaveCounts = { totalRecurring: number };

export type PayDateItem = {
  id: string;
  description: string;
  cadence: string;
  amount: number;
  type: 'income' | 'expense';
};

export function createOnboardingRunner(deps: { get: Getter; post: Poster; patch: Patcher; locale: Locale }) {
  const { get, post, patch, locale } = deps;
  let planRequests = 0;

  return {
    /** For tests: how many times /api/plan was called. Never more than asked. */
    get planRequests() {
      return planRequests;
    },

    /** One call. A failure propagates to the screen; nothing here retries. */
    async buildPlan(calculated: BuiltForm['calculated']): Promise<Plan> {
      planRequests += 1;
      const data = await post<{ plan: Plan }>('/api/plan', { source: 'calculated', calculated, locale });
      if (!data || typeof data.plan !== 'object' || data.plan === null) {
        throw new Error('/api/plan answered without a plan');
      }
      return data.plan;
    },

    /**
     * The written review. Its failure never stops the save — the web page
     * learned that the hard way (see upload/page.tsx streamReview).
     */
    async review(plan: Plan): Promise<ReviewOutcome> {
      try {
        const data = await post<{ review: string }>('/api/review-stream?stream=0', {
          plan,
          analysis: { source: 'calculated' },
          locale,
        });
        if (typeof data?.review !== 'string' || !data.review.trim()) {
          return { ok: false, messageKey: 'onboarding.plan.reviewError', resetsOn: null };
        }
        return { ok: true, text: data.review };
      } catch (err) {
        console.error('Onboarding review error:', err);
        const kind = err instanceof ApiError ? onboardingErrorKind(err.code ?? undefined) : null;
        if (kind === 'payloadTooLarge') {
          return { ok: false, messageKey: 'onboarding.plan.reviewTooLarge', resetsOn: null };
        }
        if (kind === 'notAuthenticated' || kind === 'onboardingQuotaExhausted') {
          return {
            ok: false,
            messageKey: onboardingErrorKey(err),
            resetsOn: err instanceof ApiError ? err.resetsOn : null,
          };
        }
        return { ok: false, messageKey: 'onboarding.plan.reviewError', resetsOn: null };
      }
    },

    /** confirmReplace is always false. See the header. */
    async save(
      plan: Plan,
      reviewText: string,
      cardNames: string[]
    ): Promise<AfterSaveOutcome<PayDateItem, SaveCounts>> {
      const data = await post<Parameters<typeof afterSaveOutcome<PayDateItem, SaveCounts>>[0]>('/api/save-plan', {
        plan,
        reviewText,
        locale,
        cardNames,
        fileMeta: null,
        confirmReplace: false,
      });
      return afterSaveOutcome<PayDateItem, SaveCounts>(data);
    },

    /** The household's today. A failure propagates: no guessed date. */
    async householdToday(at: () => Date = () => new Date()): Promise<string> {
      const timezone = await get<TimezoneResponse>('/api/household/timezone');
      return businessToday(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at());
    },

    /**
     * Chequing's opening balance, dated the household's today. Call ONLY
     * after a successful save — save-plan is what guarantees chequing exists.
     * Returns what happened; the screen says so if it failed.
     */
    async anchor(openingBalance: string, at: () => Date = () => new Date()): Promise<'skipped' | 'anchored' | 'failed'> {
      const value = openingAnchorValue(openingBalance);
      if (value === null) return 'skipped';
      try {
        const [accounts, timezone] = await Promise.all([
          get<AccountsResponse>('/api/accounts'),
          get<TimezoneResponse>('/api/household/timezone'),
        ]);
        const chequing = accounts.accounts.find((a) => a.type === 'chequing');
        if (!chequing) throw new Error('No chequing account to anchor');
        const today = businessToday(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at());
        await post('/api/anchors', { accountId: chequing.id, anchorDate: today, balance: value });
        return 'anchored';
      } catch (err) {
        console.error('Opening balance anchor error:', err);
        return 'failed';
      }
    },

    /**
     * What follows a 2xx save. needsConfirmation means NOTHING was written:
     * no anchor, no pay dates — the screen stops and points to the web.
     * Otherwise the opening balance is anchored now, after the save.
     */
    async afterSave(
      outcome: AfterSaveOutcome<PayDateItem, SaveCounts>,
      openingBalance: string,
      at: () => Date = () => new Date()
    ): Promise<
      | { kind: 'needsConfirmation' }
      | { kind: 'payDates'; items: PayDateItem[]; anchor: 'skipped' | 'anchored' | 'failed' }
      | { kind: 'done'; anchor: 'skipped' | 'anchored' | 'failed' }
    > {
      if (outcome.kind === 'needsConfirmation') return { kind: 'needsConfirmation' };
      const anchor = await this.anchor(openingBalance, at);
      return outcome.kind === 'needsPayDate'
        ? { kind: 'payDates', items: outcome.needsPayDate, anchor }
        : { kind: 'done', anchor };
    },

    /** One pay date. Validated by core's rules before it is sent. */
    async savePayDate(
      item: PayDateItem,
      input: PayDateInput,
      today: string
    ): Promise<{ ok: true } | { ok: false; messageKey: string; values?: Record<string, number> }> {
      const built = payDateBody(item, input, today);
      if (!built.ok) return built;
      try {
        // No memberId: the server's attribution stands. Omitting the key is
        // what leaves it untouched (recurring/[id] reads 'memberId' in body).
        await patch(`/api/recurring/${encodeURIComponent(item.id)}`, built.body);
        return { ok: true };
      } catch (err) {
        console.error('Pay date save error:', err);
        return { ok: false, messageKey: messageKeyFor(err) };
      }
    },
  };
}

// ── Pay dates ───────────────────────────────────────────────────────────────

export type PayDateInput = { nextPayDate: string; day1: string; day2: string };

export function payDateBody(
  item: PayDateItem,
  input: PayDateInput,
  today: string
):
  | { ok: true; body: { anchorDate: string; secondDay: number | null } }
  | { ok: false; messageKey: string; values?: Record<string, number> } {
  if (item.cadence === 'semimonthly') {
    const day1 = Number(input.day1.trim());
    const day2 = Number(input.day2.trim());
    // Number('') is 0, which the range check refuses; Number('1.5') is not
    // an integer, which it also refuses. No silent parseInt truncation.
    const check = validateSemimonthlyDays(day1, day2);
    if (!check.ok) return { ok: false, messageKey: `onboarding.payDates.error.${check.error}` };
    const built = buildSemimonthlyAnchor(today.slice(0, 7), day1, day2);
    return { ok: true, body: { anchorDate: built.anchorDate, secondDay: built.secondDay } };
  }
  if (item.cadence === 'weekly' || item.cadence === 'biweekly') {
    const days = item.cadence === 'weekly' ? 7 : 14;
    if (!isCalendarDate(input.nextPayDate.trim())) {
      return { ok: false, messageKey: 'onboarding.payDates.error.date' };
    }
    const check = validateNextPayDate(input.nextPayDate.trim(), item.cadence, today);
    if (!check.ok) return { ok: false, messageKey: `onboarding.payDates.error.${check.error}`, values: { days } };
    return { ok: true, body: { anchorDate: input.nextPayDate.trim(), secondDay: null } };
  }
  // save-plan only flags weekly, biweekly and semimonthly. Anything else is
  // a contract change on the server, and guessing a body would be wrong.
  return { ok: false, messageKey: 'onboarding.payDates.error.cadence' };
}

// ── Messages ────────────────────────────────────────────────────────────────

/** The message key for a failed /api/plan (or review) call. */
export function onboardingErrorKey(err: unknown): string {
  const kind = err instanceof ApiError ? onboardingErrorKind(err.code ?? undefined) : null;
  switch (kind) {
    case 'payloadTooLarge': return 'onboarding.errors.payloadTooLarge';
    case 'aiUnavailable': return 'onboarding.errors.aiUnavailable';
    case 'rateLimited': return 'onboarding.errors.rateLimited';
    case 'notAuthenticated': return 'onboarding.errors.notAuthenticated';
    case 'onboardingQuotaExhausted': return 'onboarding.errors.onboardingQuotaExhausted';
    case 'planFailed': return 'onboarding.errors.planFailed';
    case null: return messageKeyFor(err);
  }
}

export function formProblemKey(problem: FormProblem): string {
  switch (problem.kind) {
    case 'noIncome': return 'onboarding.form.problems.noIncome';
    case 'labelMissing': return 'onboarding.form.problems.labelMissing';
    case 'amountInvalid': return 'onboarding.form.problems.amountInvalid';
    case 'statedInvalid': return 'onboarding.form.problems.statedInvalid';
  }
}
