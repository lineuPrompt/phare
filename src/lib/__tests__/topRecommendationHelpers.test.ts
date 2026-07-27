import { describe, it, expect } from 'vitest';
import { enforceDebtFigureInTopRecommendation, enforceBorrowedCashFraming, containsUnsubstitutedToken, DEBT_PAYMENT_PLACEHOLDER } from '../topRecommendationHelpers';

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

describe('Fix 1 (2026-07-28): placeholder-plus-extra-figure blind spot', () => {
  const debt1000 = { description: 'Credit Line', targetDate: '2026-10', monthlyPayment: 1000.00 };

  it('discards the recommendation when a correctly-used placeholder is padded with an extra invented figure — the confirmed live blind spot, EN', () => {
    // Exact reproduction from the live diagnostic (2026-07-28): the
    // placeholder substitution alone let "$833/month" ship untouched.
    const text = `Focus on Credit Line: pay ${DEBT_PAYMENT_PLACEHOLDER}/month plus $833/month to clear it sooner.`;
    const result = enforceDebtFigureInTopRecommendation(text, debt1000, 'en');
    expect(result).not.toContain('$833');
    expect(result).not.toContain(DEBT_PAYMENT_PLACEHOLDER);
    expect(result).toContain('$1000.00');
    expect(result).toContain('Credit Line');
  });

  it('discards the recommendation when a correctly-used placeholder is padded with an extra invented figure — the confirmed live blind spot, FR', () => {
    const text = `Concentrez-vous sur Credit Line : payez ${DEBT_PAYMENT_PLACEHOLDER}/mois plus 833$/mois pour le rembourser plus vite.`;
    const result = enforceDebtFigureInTopRecommendation(text, debt1000, 'fr');
    expect(result).not.toContain('833');
    expect(result).not.toContain(DEBT_PAYMENT_PLACEHOLDER);
    expect(result).toContain('1000.00');
    expect(result).toContain('Credit Line');
  });

  it('control: placeholder present, no extra figure — normal substitution still works unchanged', () => {
    const text = `Focus on Credit Line: pay ${DEBT_PAYMENT_PLACEHOLDER}/month to clear it on schedule.`;
    const result = enforceDebtFigureInTopRecommendation(text, debt1000, 'en');
    expect(result).toBe('Focus on Credit Line: pay $1000.00/month to clear it on schedule.');
  });

  it('control: the placeholder repeated twice (same real figure) is not treated as an extra/unauthorized figure', () => {
    const text = `Pay ${DEBT_PAYMENT_PLACEHOLDER}/month now, ${DEBT_PAYMENT_PLACEHOLDER}/month again next month toward Credit Line.`;
    const result = enforceDebtFigureInTopRecommendation(text, debt1000, 'en');
    expect(result).toBe('Pay $1000.00/month now, $1000.00/month again next month toward Credit Line.');
  });
});

describe('enforceBorrowedCashFraming (Fix 4, 2026-07-28)', () => {
  it('passes text through unchanged when nothing was borrowed', () => {
    const text = 'Your $1,000 surplus this month is a great sign.';
    expect(enforceBorrowedCashFraming(text, 0, 'en')).toBe(text);
  });

  it('replaces the recommendation when the borrowed amount is labeled as surplus — no debt-payoff card needed', () => {
    const text = 'Your $1,000 line-of-credit draw gives you $1,000 of surplus to invest.';
    const result = enforceBorrowedCashFraming(text, 1000, 'en');
    expect(result).not.toBe(text);
    expect(result).toContain('$1000.00');
    expect(result).toContain('borrowed');
  });

  it('replaces the recommendation when the borrowed amount is called "extra" income', () => {
    const text = 'You have an extra $1,000 available this month to put toward your goals.';
    const result = enforceBorrowedCashFraming(text, 1000, 'en');
    expect(result).toContain('borrowed');
    expect(result).not.toContain('an extra $1,000 available');
  });

  it('leaves the text alone when the borrowed figure is disclosed honestly, with no surplus-labeling word nearby', () => {
    const text = 'Part of this month\'s cash — $1,000 — was borrowed from your credit line, not earned.';
    expect(enforceBorrowedCashFraming(text, 1000, 'en')).toBe(text);
  });

  it('leaves the text alone when the borrowed figure never appears at all', () => {
    const text = 'Your net cash flow this month was $200, a modest but real gain.';
    expect(enforceBorrowedCashFraming(text, 1000, 'en')).toBe(text);
  });

  it('builds a French fallback when locale is fr', () => {
    const text = 'Vous avez 1000$ de surplus supplémentaire à investir ce mois-ci.';
    const result = enforceBorrowedCashFraming(text, 1000, 'fr');
    expect(result).toContain('1000.00');
    expect(result).toContain('emprunt');
  });

  it('CONTROL (Codex finding 4): an unrelated category coincidentally named "Extra" near an unrelated coincidentally-equal figure is not a false positive — the guard requires the label to sit near the SAME occurrence as the real draw', () => {
    const text = 'Your Extra category had a $1,000 refund; your credit-line draw was $1,000 and must be repaid.';
    expect(enforceBorrowedCashFraming(text, 1000, 'en')).toBe(text);
  });

  it('still fires when the label is genuinely close to the SAME occurrence of the real figure, even with an unrelated same-value figure elsewhere in the text', () => {
    const text = 'Your Extra category had a $1,000 refund; that extra $1,000 could go toward your goals.';
    const result = enforceBorrowedCashFraming(text, 1000, 'en');
    expect(result).not.toBe(text);
    expect(result).toContain('borrowed');
  });

  it('word-boundary: "extraordinary" does not match the "extra" label', () => {
    const text = "It's been an extraordinary month — your credit line draw was $1,000 and must be repaid.";
    expect(enforceBorrowedCashFraming(text, 1000, 'en')).toBe(text);
  });
});

describe('containsUnsubstitutedToken', () => {
  it('detects a {{...}} shaped token by pattern, not by a fixed name', () => {
    expect(containsUnsubstitutedToken('pay {{DEBT_PAYMENT}}/month')).toBe(true);
    expect(containsUnsubstitutedToken('pay {{SOME_FUTURE_TOKEN}}/month')).toBe(true);
    expect(containsUnsubstitutedToken('a perfectly normal sentence')).toBe(false);
  });
});

describe('Follow-up (2026-07-28): leaked {{...}} token ships to the user', () => {
  const debt1000 = { description: 'Credit Line', targetDate: '2026-10', monthlyPayment: 1000.00 };

  it('the exact observed live failure: debtPayoff is null (bare credit-line draw, no debt account) and the model still wrote {{DEBT_PAYMENT}}', () => {
    const text = "...repay that credit line at its {{DEBT_PAYMENT}}/month required payment so the borrowed amount doesn't accumulate interest.";
    const result = enforceDebtFigureInTopRecommendation(text, null, 'en');
    expect(result).not.toContain('{{DEBT_PAYMENT}}');
    expect(result).not.toBe(text);
    expect(result).toContain("couldn't be generated safely");
  });

  it('generalizes: a differently-named token leaks with debtPayoff null too', () => {
    const text = 'Consider putting {{EXTRA_ROOM}} toward your goals this month.';
    const result = enforceDebtFigureInTopRecommendation(text, null, 'en');
    expect(result).not.toContain('{{EXTRA_ROOM}}');
    expect(result).toContain("couldn't be generated safely");
  });

  it('control: normal substitution is unaffected when debtPayoff exists and no stray token leaks', () => {
    const text = `Apply your regular ${DEBT_PAYMENT_PLACEHOLDER}/month toward Credit Line to stay on track.`;
    const result = enforceDebtFigureInTopRecommendation(text, debt1000, 'en');
    expect(result).toBe('Apply your regular $1000.00/month toward Credit Line to stay on track.');
  });

  it('a DIFFERENT token leaking alongside a correctly-substituted placeholder is still caught, debtPayoff non-null', () => {
    const text = `Pay ${DEBT_PAYMENT_PLACEHOLDER}/month toward Credit Line, plus {{BONUS_AMOUNT}} if you can.`;
    const result = enforceDebtFigureInTopRecommendation(text, debt1000, 'en');
    expect(result).not.toContain('{{BONUS_AMOUNT}}');
    expect(result).not.toContain(DEBT_PAYMENT_PLACEHOLDER);
    expect(result).toContain('$1000.00');
    expect(result).toContain('Credit Line');
  });

  it('French: a leaked token with debtPayoff null gets the French generic fallback', () => {
    const text = 'Payez {{DEBT_PAYMENT}}/mois pour rembourser la marge de crédit plus rapidement.';
    const result = enforceDebtFigureInTopRecommendation(text, null, 'fr');
    expect(result).not.toContain('{{DEBT_PAYMENT}}');
    expect(result).toContain('pas pu être générée');
  });
});
