/**
 * Contribution drift — the one place that answers "do the materialized
 * future rows still agree with the rule that made them?"
 *
 * WHY THIS EXISTS. A recurring contribution is stored twice by design: the
 * rule (recurring_items.amount) and the rows it materialized ahead of time
 * (transactions.amount, up to 12 months out). Normally they cannot disagree
 * — the rows exist because the rule generated them. But editing a single
 * occurrence DETACHES it: PATCH /api/transfers/[id] tombstones the date and
 * nulls recurring_item_id on both pair rows, precisely so a later rule edit
 * can't silently revert the household's hand edit.
 *
 * The consequence is that a detached row is unreachable from its rule — you
 * cannot find it with a join, because the foreign key is gone. A summary
 * line reading the rule will happily print "$25/2wk" over a list of rows
 * that every say $125, and nothing in the data model objects.
 *
 * So drift is detected positionally instead: among the future rows sitting
 * in this goal/buffer account, how many carry an amount the rule would never
 * have produced. Detached or still attached is irrelevant to the question —
 * what matters is what the household will actually see listed.
 *
 * Callers use this to (a) say so on screen, and (b) suppress any projection
 * built on the rule amount, which is guaranteed wrong while drift exists.
 * It never rewrites anything and never blends the two figures into one
 * number — a blended total is unverifiable by the person reading it.
 */

export type ContributionDrift = {
  /** Future rows whose magnitude differs from the rule's. Always >= 1. */
  count: number;
  /** Distinct differing magnitudes, ascending — usually exactly one. */
  amounts: number[];
  /** The rule amount they disagree with, echoed for the message. */
  ruleAmount: number;
};

/** Cent-level tolerance: these are money columns, compared as magnitudes. */
const EPSILON = 0.005;

/**
 * Rows must be the FUTURE rows for one account (date > today) — the caller
 * has already split past from future, and past rows are real history that
 * may legitimately differ from today's rule (that is exactly what an
 * effective-dated change leaves behind). Returns null when there is nothing
 * to report: no rule, no rows, or everything agrees.
 *
 * `effectiveFrom` is the active rule's own effective_from, and rows dated
 * before it are EXCLUDED rather than judged. A future row can predate the
 * rule that is current today: raise a contribution in September effective
 * October and the split deliberately leaves the September occurrence at the
 * old amount, attached to the now-frozen predecessor. That row is the
 * forward-apply guarantee working exactly as promised — reporting it as
 * disagreement would turn every correct effective-dated change into a
 * warning. Verified against the live database, where the reserve buffer's
 * 2026-09-30 row at $350 sits under a $628.02 rule effective 2026-10-01.
 *
 * A null effectiveFrom means the rule has never been superseded, so it owns
 * every row on the account.
 */
export function computeContributionDrift(
  futureRows: { date: string; amount: number }[],
  ruleAmount: number | null,
  effectiveFrom: string | null
): ContributionDrift | null {
  if (ruleAmount == null || futureRows.length === 0) return null;

  const owned = effectiveFrom
    ? futureRows.filter((r) => r.date >= effectiveFrom)
    : futureRows;
  if (owned.length === 0) return null;

  const ruleMagnitude = Math.abs(ruleAmount);
  const differing = owned
    .map((r) => Math.abs(r.amount))
    .filter((a) => Math.abs(a - ruleMagnitude) > EPSILON);

  if (differing.length === 0) return null;

  return {
    count: differing.length,
    amounts: [...new Set(differing)].sort((a, b) => a - b),
    ruleAmount: ruleMagnitude,
  };
}
