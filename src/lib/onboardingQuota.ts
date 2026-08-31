import { quotaFrom, resetDateFor, type QuotaState } from '@/lib/regenerationQuota';

// ---------------------------------------------------------------------------
// How many onboarding generations a household may spend in a calendar month.
//
// WHAT THIS BOUNDS. /api/plan and /api/review-stream each spend Anthropic
// tokens on every call and, until now, were unauthenticated with only an
// in-process IP limiter in front of them. That limiter does not bind: its state
// is a Map per lambda (rateLimit.ts), so N instances allow N windows, and it is
// keyed on x-forwarded-for, which carrier CGNAT collapses to one address for
// many households at once. On mobile it would either lock out real users or
// count nothing. This counts rows in `events` instead — durable, shared across
// every instance, and keyed on the household rather than the network path.
//
// WHAT IT DOES NOT BOUND, stated plainly so nobody mistakes it for a wall:
// signup is open and free, so an attacker willing to create a throwaway
// household gets a fresh allowance each time. This raises abuse from "free and
// anonymous and unbounded" to "one signup per ten generations, with a user_id
// on every row". That is attribution plus a real ceiling per identity. It is
// not proof against a determined attacker, and no per-household quota on a
// free-signup product can be.
//
// TWO COUNTERS, NOT ONE SHARED RESERVATION. A full onboarding fires /api/plan
// once and /api/review-stream once, so it would be tempting to have the review
// ride on the plan's reservation. That is wrong: nothing stops a script calling
// /api/review-stream directly without ever touching /api/plan, and a route that
// only READS a counter it never increments is unbounded. Each route reserves
// against its own event type, both capped at the same number.
//
// CALENDAR MONTH, IN THE HOUSEHOLD'S TIMEZONE — identical to the regeneration
// quota, deliberately, so this codebase has one quota idiom rather than two.
// The month is stamped on the event row at write time, so counting is an
// equality match that cannot drift as a timezone boundary moves.
// ---------------------------------------------------------------------------

/**
 * Ten per month, per household, per route.
 *
 * A complete onboarding costs ONE from each counter. The worst legitimate
 * first-time session — a user who errors out and restarts twice — reaches
 * three. A household that genuinely re-onboards (they redid their budget; the
 * replace-confirmation flow exists for exactly this) does so a handful of times
 * a year, not ten times a month.
 *
 * So ten is roughly 3-5x the worst honest path, and still bounds a throwaway
 * household to twenty Anthropic calls before it must wait for the 1st.
 */
export const ONBOARDING_GENERATIONS_PER_MONTH = 10;

/** Reserved by POST /api/plan, before the model is called. */
export const PLAN_GENERATION_EVENT = 'onboarding_plan_generated' as const;

/** Reserved by POST /api/review-stream, before the model is called. */
export const REVIEW_GENERATION_EVENT = 'onboarding_review_generated' as const;

export type OnboardingQuotaEvent =
  | typeof PLAN_GENERATION_EVENT
  | typeof REVIEW_GENERATION_EVENT;

// The arithmetic (`quotaFrom`) and the reset-date derivation (`resetDateFor`)
// are imported rather than reimplemented. They are generic counter maths that
// happen to live next to the regeneration quota because that was the first
// caller; their boundary cases — zero used, one short, exactly at the cap,
// somehow over — are already pinned by regenerationQuota's own tests. Writing a
// second copy here would be a second thing to keep correct.
export { resetDateFor, type QuotaState };

/** Quota arithmetic at the onboarding limit. */
export function onboardingQuotaFrom(used: number, month: string): QuotaState {
  return quotaFrom(used, month, ONBOARDING_GENERATIONS_PER_MONTH);
}

/**
 * 'YYYY-MM-DD' → a date a person reads, in their own locale.
 *
 * TWO INDEPENDENT GUARDS against the off-by-one-day slip, and this is not
 * belt-and-braces by accident — mutation testing showed each one alone is
 * sufficient, so removing either in isolation changes nothing observable:
 *
 *   - `timeZone: 'UTC'` on the formatter, so the ambient server/browser zone
 *     cannot shift the rendered day.
 *   - parsing at NOON rather than midnight, so even without that option there
 *     are twelve hours of slack either side.
 *
 * Without BOTH, `new Date('2026-09-01')` is midnight UTC and formats as August
 * 31st in every Canadian zone: the household would be told its allowance
 * refills the day before it actually does. Do not "simplify" by deleting one
 * on the grounds that the tests still pass — they pass because the other is
 * still there.
 *
 * Returns '' for a missing or malformed value so the caller renders a message
 * with a blank date rather than "Invalid Date".
 */
export function formatResetDate(resetsOn: string | undefined, locale: string): string {
  if (!resetsOn || !/^\d{4}-\d{2}-\d{2}$/.test(resetsOn)) return '';
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${resetsOn}T12:00:00Z`));
}
