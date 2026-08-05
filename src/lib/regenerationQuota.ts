// ---------------------------------------------------------------------------
// How many review regenerations a household has left this month.
//
// The pricing card sells "Refresh your review up to 4 times a month". Until
// this existed we advertised a limit and enforced nothing, on the most
// expensive prompt in the app — fifteen comped households regenerating freely
// is a real bill, not a theoretical one.
//
// FREE HOUSEHOLDS GET ZERO, and already do: POST /api/regenerate-plan is
// entirely Pro-gated (403 pro_required), so this quota is a Pro-only concept
// rather than a two-tier number. That is also the coherent product answer —
// regenerating a review you can only read the first paragraph of makes no
// sense.
//
// NOT THE IN-PROCESS LIMITER. src/lib/rateLimit.ts is memory-resident: it
// resets on every deploy and differs per lambda, which is fine for a 60-second
// burst gate and useless for a monthly allowance. This counts rows.
//
// CALENDAR MONTH, IN THE HOUSEHOLD'S TIMEZONE. "4 times a month" reads as a
// calendar month to a person, and it is the only shape that lets the UI name a
// reset date. The timezone matters: counting in UTC would roll a Quebec
// household's quota over at 8pm on the 31st.
//
// The month is stored ON the event rather than derived from created_at at read
// time. That removes timestamp arithmetic entirely — the month is computed once,
// with the household's own timezone, at the moment the regeneration happens, and
// counting is then an equality match that cannot drift.
// ---------------------------------------------------------------------------

export const REGENERATIONS_PER_MONTH = 4;

/** The event that both records and counts a regeneration. */
export const REGENERATION_EVENT = 'review_regenerated' as const;

export type QuotaState = {
  used: number;
  limit: number;
  remaining: number;
  /** False when the next regeneration must be refused. */
  allowed: boolean;
  /** 'YYYY-MM' the count applies to. */
  month: string;
  /** 'YYYY-MM-DD' the allowance refills — the first of the next month. */
  resetsOn: string;
};

/** First day of the month after `month` ('YYYY-MM' → 'YYYY-MM-DD'). */
export function resetDateFor(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return '';
  const year = Number(m[1]);
  const mon = Number(m[2]);
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
}

/**
 * Pure quota arithmetic. Separated from the database read so the boundaries —
 * zero used, one short of the cap, exactly at it, and somehow over — are
 * testable without a Supabase client.
 *
 * A count ABOVE the limit still reads as not allowed rather than wrapping to a
 * negative remaining: if a race ever let a fifth through, the fix is to stop,
 * not to hand out a sixth.
 */
export function quotaFrom(used: number, month: string, limit = REGENERATIONS_PER_MONTH): QuotaState {
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  return {
    used: safeUsed,
    limit,
    remaining: Math.max(0, limit - safeUsed),
    allowed: safeUsed < limit,
    month,
    resetsOn: resetDateFor(month),
  };
}
