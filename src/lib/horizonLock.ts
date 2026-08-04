// ---------------------------------------------------------------------------
// Is the month being viewed inside the locked band of the projection horizon?
//
// A free household's /api/timeline response contains 3 chain months where a Pro
// household's contains 12. The dashboard finds the viewed month by matching
// against that array, so months 4–12 resolve to `null` — and PlanChainTile
// renders nothing at all for a null month.
//
// That is correct for a month genuinely outside the computed window, and wrong
// for one that exists but was withheld: the household navigates forward and the
// projection simply disappears, which reads as a bug rather than as a tier.
// This distinguishes the two cases so the second can say what is behind it.
//
// Pure and month-string based — no dates, no timezone, nothing to drift.
// ---------------------------------------------------------------------------

export type HorizonPlan = {
  months: { month: string }[];
  /** How many months were RETURNED (3 free, 12 Pro). */
  horizonMonths: number;
  /** How many were COMPUTED — always 12. The gap is what is locked. */
  horizonAvailable: number;
  horizonLocked: boolean;
};

export type HorizonLockState = {
  /** True when this month exists in the computed window but was withheld. */
  locked: boolean;
  /** How many further months a Pro household would see. Never negative. */
  remainingMonths: number;
};

/**
 * Whole months from `startMonth` to `month`, both 'YYYY-MM'.
 * Negative when `month` is earlier. Returns null for malformed input rather
 * than NaN, so a bad value can never be mistaken for month zero.
 */
export function monthOffset(startMonth: string, month: string): number | null {
  const m1 = /^(\d{4})-(\d{2})$/.exec(startMonth);
  const m2 = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m1 || !m2) return null;
  const a = Number(m1[1]) * 12 + (Number(m1[2]) - 1);
  const b = Number(m2[1]) * 12 + (Number(m2[2]) - 1);
  return b - a;
}

/**
 * Decide whether the viewed month is locked, and how much is behind the lock.
 *
 * Deliberately conservative: anything it cannot positively identify as inside
 * the locked band reads as NOT locked. Showing an upgrade prompt on a month
 * that genuinely has no data would be inviting someone to pay for nothing.
 */
export function horizonLockState(
  plan: HorizonPlan | null | undefined,
  displayMonth: string,
  planMonthFound: boolean
): HorizonLockState {
  const none: HorizonLockState = { locked: false, remainingMonths: 0 };

  // The month resolved to real chain data — nothing is being withheld.
  if (planMonthFound) return none;
  if (!plan || !plan.horizonLocked) return none;
  if (plan.months.length === 0) return none;

  const offset = monthOffset(plan.months[0].month, displayMonth);
  if (offset === null) return none;

  // Inside the computed window, but past what this tier receives.
  const inLockedBand = offset >= plan.horizonMonths && offset < plan.horizonAvailable;
  if (!inLockedBand) return none;

  return {
    locked: true,
    remainingMonths: Math.max(0, plan.horizonAvailable - plan.horizonMonths),
  };
}
