import { describe, it, expect } from 'vitest';
import { enforceDebtFigureInTopRecommendation, DEBT_PAYMENT_PLACEHOLDER } from '../topRecommendationHelpers';

const debtPayoff = { description: 'Credit Line', targetDate: '2026-10', monthlyPayment: 833.33 };

describe('enforceDebtFigureInTopRecommendation', () => {
  it('passes text through unchanged when there is no debt payoff at all', () => {
    const text = 'Consider applying $3,000 toward your goals this month.';
    expect(enforceDebtFigureInTopRecommendation(text, null, 'en')).toBe(text);
  });

  it('passes text through unchanged when the debt is not mentioned', () => {
    const text = 'Your Disney trip goal could use an extra $200 this month.';
    expect(enforceDebtFigureInTopRecommendation(text, debtPayoff, 'en')).toBe(text);
  });

  it('substitutes the placeholder with the real, code-computed payment amount', () => {
    const text = `Apply your regular ${DEBT_PAYMENT_PLACEHOLDER}/month toward Credit Line to stay on track.`;
    const result = enforceDebtFigureInTopRecommendation(text, debtPayoff, 'en');
    expect(result).toBe('Apply your regular $833.33/month toward Credit Line to stay on track.');
  });

  it('substitutes every occurrence of the placeholder, not just the first', () => {
    const text = `${DEBT_PAYMENT_PLACEHOLDER} now, ${DEBT_PAYMENT_PLACEHOLDER} again next month — same Credit Line payment.`;
    const result = enforceDebtFigureInTopRecommendation(text, debtPayoff, 'en');
    expect(result).toBe('$833.33 now, $833.33 again next month — same Credit Line payment.');
  });

  it('discards a fabricated dollar figure and replaces it with a deterministic fallback — the confirmed live failure mode', () => {
    // The real observed bug: the model named the debt but typed its own
    // number ($3,000) instead of the placeholder.
    const text = 'With your credit line targeted for payoff by October 2026, aim to apply at least $3,000 of it this month.';
    const result = enforceDebtFigureInTopRecommendation(text, debtPayoff, 'en');
    expect(result).not.toContain('3,000');
    expect(result).not.toContain('$3,000');
    expect(result).toContain('$833.33');
    expect(result).toContain('Credit Line');
  });

  it('is deterministic: two different fabricated inputs for the same debt produce the identical corrected output', () => {
    const runA = enforceDebtFigureInTopRecommendation(
      'Put at least $3,000 toward Credit Line this month.',
      debtPayoff,
      'en'
    );
    const runB = enforceDebtFigureInTopRecommendation(
      'Consider directing $833 to Credit Line as a start.',
      debtPayoff,
      'en'
    );
    expect(runA).toBe(runB);
    expect(runA).toContain('$833.33');
  });

  it('builds the French fallback when locale is fr', () => {
    const text = 'Visez au moins 3000$ pour la Credit Line ce mois-ci.';
    const result = enforceDebtFigureInTopRecommendation(text, debtPayoff, 'fr');
    expect(result).toContain('833.33');
    expect(result).toContain('Credit Line');
    expect(result).not.toContain('3000');
  });

  it('leaves text alone when the debt is named with no dollar amount present at all', () => {
    const text = 'Keep an eye on your Credit Line balance this month.';
    expect(enforceDebtFigureInTopRecommendation(text, debtPayoff, 'en')).toBe(text);
  });
});
