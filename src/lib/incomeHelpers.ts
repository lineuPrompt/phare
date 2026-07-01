export type IncomeFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Converts a per-paycheque amount to a monthly equivalent.
 *
 * weekly:      52 pays/year ÷ 12 months
 * biweekly:    26 pays/year ÷ 12 months — NOT 2× per month; produces two windfall months/year
 * semimonthly: exactly 2× per month = 24 pays/year (no windfall, always predictable)
 * monthly:     1× per month
 *
 * Code owns this math. The user enters the paycheque amount; code computes the monthly figure.
 */
export function monthlyIncomeEquivalent(amount: number, frequency: IncomeFrequency): number {
  switch (frequency) {
    case 'weekly':      return round2(amount * 52 / 12);
    case 'biweekly':    return round2(amount * 26 / 12);
    case 'semimonthly': return round2(amount * 2);
    case 'monthly':     return round2(amount);
  }
}
