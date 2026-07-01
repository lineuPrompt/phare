import { describe, it, expect } from 'vitest';
import {
  checkIncomeVsStated,
  checkDeficitNotFinanced,
  runPlausibilityGuard,
} from '../plausibilityGuard';

// ── Prong (a): income vs stated combined income ────────────────────────────

describe('checkIncomeVsStated', () => {
  it('fires when computed annual is less than 60% of stated', () => {
    // Stated: $120,000/yr. Computed: $5,875/mo × 12 = $70,500/yr.
    // $70,500 < 0.6 × $120,000 = $72,000 → should fire.
    const result = checkIncomeVsStated(5875, 120_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].prong).toBe('income_vs_stated');
    }
  });

  it('fires on roughly half-stated income (the actual trial bug)', () => {
    // Family stated $134K combined. Parser returned $5,875/mo (half of real $11,150).
    // $5,875 × 12 = $70,500 < 0.6 × $134,000 = $80,400 → fires.
    const result = checkIncomeVsStated(5875, 134_000);
    expect(result.ok).toBe(false);
  });

  it('does NOT fire when computed income is within 60% of stated', () => {
    // Stated: $120,000/yr. Computed: $8,000/mo × 12 = $96,000/yr.
    // $96,000 ≥ 0.6 × $120,000 = $72,000 → ok.
    const result = checkIncomeVsStated(8000, 120_000);
    expect(result.ok).toBe(true);
  });

  it('does NOT fire when statedCombinedAnnual is null', () => {
    expect(checkIncomeVsStated(1000, null).ok).toBe(true);
  });

  it('does NOT fire when statedCombinedAnnual is 0', () => {
    expect(checkIncomeVsStated(1000, 0).ok).toBe(true);
  });

  it('includes the stated and computed annual figures in the issue', () => {
    const result = checkIncomeVsStated(3000, 100_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues[0];
      expect(issue.prong).toBe('income_vs_stated');
      if (issue.prong === 'income_vs_stated') {
        expect(issue.statedAnnual).toBe(100_000);
        expect(issue.computedAnnual).toBe(36_000);
      }
    }
  });
});

// ── Prong (b): deficit not financed ───────────────────────────────────────

describe('checkDeficitNotFinanced', () => {
  it('fires on a significant deficit with no debt-servicing line', () => {
    const expenses = [
      { label: 'Mortgage' },
      { label: 'Groceries' },
      { label: 'Hydro' },
    ];
    const result = checkDeficitNotFinanced(-771, expenses);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].prong).toBe('deficit_not_financed');
    }
  });

  it('does NOT fire when a credit line expense is present', () => {
    const expenses = [
      { label: 'Mortgage' },
      { label: 'Line of credit payment' },
    ];
    expect(checkDeficitNotFinanced(-771, expenses).ok).toBe(true);
  });

  it('does NOT fire when a VISA payment is listed', () => {
    const expenses = [{ label: 'Visa minimum payment' }];
    expect(checkDeficitNotFinanced(-800, expenses).ok).toBe(true);
  });

  it('does NOT fire when deficit is within noise threshold ($100)', () => {
    const expenses = [{ label: 'Mortgage' }];
    expect(checkDeficitNotFinanced(-50, expenses).ok).toBe(true);
    expect(checkDeficitNotFinanced(-99, expenses).ok).toBe(true);
  });

  it('does NOT fire when there is no deficit', () => {
    const expenses = [{ label: 'Mortgage' }];
    expect(checkDeficitNotFinanced(500, expenses).ok).toBe(true);
    expect(checkDeficitNotFinanced(0, expenses).ok).toBe(true);
  });

  it('includes the monthly deficit amount in the issue', () => {
    const result = checkDeficitNotFinanced(-771, [{ label: 'Rent' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues[0];
      if (issue.prong === 'deficit_not_financed') {
        expect(issue.monthlyDeficit).toBe(771);
      }
    }
  });
});

// ── Combined guard ─────────────────────────────────────────────────────────

describe('runPlausibilityGuard', () => {
  const noDebtExpenses = [{ label: 'Mortgage' }, { label: 'Groceries' }];

  it('returns ok:true on correct data (real surplus, stated income matches)', () => {
    const result = runPlausibilityGuard({
      computedMonthlyIncome: 11_150,
      netCashFlow: 4_600,
      expenseLines: noDebtExpenses,
      statedCombinedAnnual: 134_000,
    });
    expect(result.ok).toBe(true);
  });

  it('fires prong (a) when income is ~half of stated', () => {
    const result = runPlausibilityGuard({
      computedMonthlyIncome: 5_875, // half of real $11,150
      netCashFlow: -771,            // apparent deficit
      expenseLines: noDebtExpenses,
      statedCombinedAnnual: 134_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const prongs = result.issues.map((i) => i.prong);
      expect(prongs).toContain('income_vs_stated');
    }
  });

  it('fires prong (b) on an unfinanced deficit with no stated combined income', () => {
    const result = runPlausibilityGuard({
      computedMonthlyIncome: 5_875,
      netCashFlow: -771,
      expenseLines: noDebtExpenses,
      statedCombinedAnnual: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.prong)).toContain('deficit_not_financed');
    }
  });

  it('fires both prongs when both conditions are met', () => {
    const result = runPlausibilityGuard({
      computedMonthlyIncome: 3_000,
      netCashFlow: -500,
      expenseLines: noDebtExpenses,
      statedCombinedAnnual: 120_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const prongs = result.issues.map((i) => i.prong);
      expect(prongs).toContain('income_vs_stated');
      expect(prongs).toContain('deficit_not_financed');
    }
  });

  it('does NOT fire when deficit is financed by visible credit', () => {
    const result = runPlausibilityGuard({
      computedMonthlyIncome: 3_000,
      netCashFlow: -500,
      expenseLines: [{ label: 'Mortgage' }, { label: 'Credit line' }],
      statedCombinedAnnual: null,
    });
    expect(result.ok).toBe(true);
  });
});
