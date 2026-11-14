/**
 * Plan card display helpers, shared by the web dashboard and the app's Home
 * (2026-11-14). DISPLAY ONLY — every figure they touch is the server's plan
 * chain (src/lib/planChainHelpers.ts), passed in. Nothing here adds money.
 *
 * Both platforms draw the month-end path from planPathGeometry, so a bar is
 * the same height on a phone as on the web, and both write the "why" line's
 * dates through formatPlanDates.
 */

export type PlanPathBar = {
  /** Distance from the top of the chart, as a fraction of its height. */
  top: number;
  /** Bar height, as a fraction of the chart height. */
  height: number;
  negative: boolean;
};

/**
 * Bars for month-end balances around a zero line. The scale always includes
 * zero, so an all-positive path still shows how far it sits above it.
 * `zero` is the zero line's distance from the top, as a fraction.
 */
export function planPathGeometry(values: number[]): { zero: number; bars: PlanPathBar[] } {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min;
  if (span === 0) {
    // Every month ends at exactly zero: a flat line, no bars.
    return { zero: 1, bars: values.map(() => ({ top: 1, height: 0, negative: false })) };
  }
  const zero = max / span;
  return {
    zero,
    bars: values.map((v) =>
      v >= 0
        ? { top: (max - v) / span, height: v / span, negative: false }
        : { top: zero, height: -v / span, negative: true }
    ),
  };
}

const MONTH_NAMES = (locale: string) => (locale === 'fr' ? 'fr-CA' : 'en-CA');

function monthName(date: string, locale: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(MONTH_NAMES(locale), { month: 'long' });
}

/**
 * Planned dates inside ONE month, as a household reads them:
 *   en → "May 3, 17, 31"     fr → "3, 17 et 31 mai"
 * The dates come from the plan's own rows (YYYY-MM-DD); only the day numbers
 * and the month's name are printed.
 */
export function formatPlanDates(dates: string[], locale: string): string {
  if (dates.length === 0) return '';
  const days = dates.map((d) => String(Number(d.slice(8, 10))));
  const name = monthName(dates[0], locale);
  if (locale === 'fr') {
    const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} et ${days[days.length - 1]}`;
    return `${list} ${name}`;
  }
  return `${name} ${days.join(', ')}`;
}

/** One-letter month label under a bar ("M" / "m"), in the household's language. */
export function planPathMonthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(MONTH_NAMES(locale), { month: 'narrow' });
}

/**
 * A month label that opens a sentence, in sentence case. French month names
 * are lower-case ("mai 2027"); "Mai 2027 compte…" needs the capital.
 */
export function sentenceStart(label: string, locale: string): string {
  return label.charAt(0).toLocaleUpperCase(locale === 'fr' ? 'fr-CA' : 'en-CA') + label.slice(1);
}

/**
 * Which words a card's line takes in a future month's sum. A statement still
 * running is "statement so far"; one already closed (not yet paid) is final,
 * so it is "closed statement", not "so far".
 */
export type PlanCardBasisKey = 'cardBudget' | 'cardSoFar' | 'cardClosed' | 'cardMax' | 'cardPosted';

export function planCardBasisKey(basis: 'actual' | 'budget' | 'max' | 'posted', inProgress: boolean): PlanCardBasisKey {
  switch (basis) {
    case 'budget': return 'cardBudget';
    case 'max': return 'cardMax';
    case 'posted': return 'cardPosted';
    case 'actual': return inProgress ? 'cardSoFar' : 'cardClosed';
  }
}
