import { describe, it, expect } from 'vitest';
import { previewOfReview, reviewForEntitlement, REVIEW_PREVIEW_CHARS } from '@/lib/reviewPreview';

// The paywall lives here. Two failure modes matter: leaking the full review to
// a free household, and producing a preview that reads like a bug.

const LONG = [
  'June was a solid month overall.',
  'You stayed within budget in four of five categories, and your reserve fund grew by $250.',
  'The one to watch is Restaurants, which ran $180 over plan for the third month running.',
  'This month, move $100 of that into your property tax fund before the March bill lands.',
].join(' ') + ' ' + 'Extra padding sentence to push well past the preview budget so truncation is guaranteed.';

describe('previewOfReview', () => {
  it('returns short text untouched and NOT truncated', () => {
    const short = 'June was a solid month.';
    expect(previewOfReview(short)).toEqual({ text: short, truncated: false });
  });

  it('cuts long text and flags it', () => {
    const p = previewOfReview(LONG);
    expect(p.truncated).toBe(true);
    expect(p.text.length).toBeLessThan(LONG.length);
  });

  it('ends on a sentence boundary, not mid-clause', () => {
    const p = previewOfReview(LONG);
    // A preview that stops mid-sentence reads as a bug, and a bug is not a
    // persuasive reason to pay.
    expect(p.text).toMatch(/[.!?…]$/);
  });

  it('never exceeds the budget', () => {
    const p = previewOfReview(LONG);
    expect(p.text.length).toBeLessThanOrEqual(REVIEW_PREVIEW_CHARS + 1);
  });

  it('does NOT cut inside a money figure', () => {
    // The decimal point in "$1,500.50" is a period followed by a digit, not a
    // sentence end. Reviews are full of amounts, so this is the common case.
    const text = 'Your mortgage came to $1,500.50 this month which is exactly on plan and nothing to worry about at all. '
      + 'Second sentence here. '.repeat(20);
    const p = previewOfReview(text);
    expect(p.text).not.toMatch(/\$1,500\.$/);
    expect(p.text).toMatch(/[.!?…]$/);
  });

  it('falls back to a word boundary when no sentence end fits', () => {
    const noSentences = 'word '.repeat(200).trim();
    const p = previewOfReview(noSentences);
    expect(p.truncated).toBe(true);
    // Never mid-word.
    expect(p.text).not.toMatch(/wor…$/);
    expect(p.text.endsWith('…')).toBe(true);
  });

  it('still truncates text with no whitespace at all', () => {
    // Pathological, but returning the whole thing would leak the full review.
    const blob = 'x'.repeat(1000);
    const p = previewOfReview(blob);
    expect(p.truncated).toBe(true);
    expect(p.text.length).toBeLessThanOrEqual(REVIEW_PREVIEW_CHARS + 1);
  });

  it('handles French punctuation and accents', () => {
    const fr = 'Juin a été un bon mois dans l’ensemble. '
      + 'Vous êtes resté dans les limites du budget pour quatre catégories sur cinq, et votre fonds de réserve a augmenté de 250 $. '
      + 'Ce qu’il faut surveiller, c’est la catégorie Restaurants, qui dépasse le plan de 180 $ pour un troisième mois consécutif. '
      + 'Ce mois-ci, transférez 100 $ vers votre fonds de taxes municipales.';
    const p = previewOfReview(fr);
    expect(p.truncated).toBe(true);
    expect(p.text).toMatch(/[.!?…]$/);
    // Accents survive the slice intact.
    expect(p.text).toContain('été');
  });

  it('empty / null / undefined are not truncated', () => {
    for (const v of ['', null, undefined]) {
      expect(previewOfReview(v)).toEqual({ text: '', truncated: false });
    }
  });
});

describe('reviewForEntitlement', () => {
  it('Pro gets the FULL review, unlocked', () => {
    expect(reviewForEntitlement(LONG, true)).toEqual({ review: LONG, reviewLocked: false });
  });

  it('free gets a truncated preview, locked', () => {
    const r = reviewForEntitlement(LONG, false);
    expect(r.reviewLocked).toBe(true);
    expect(r.review!.length).toBeLessThan(LONG.length);
    // The thing that matters: the rest of the text is NOT in the payload.
    expect(r.review).not.toContain('Extra padding sentence');
  });

  it('a review short enough to fit is not marked locked for free users', () => {
    // Otherwise the UI shows an upgrade prompt for text the household can
    // already read in full — an invitation to pay for nothing.
    const short = 'June was a solid month.';
    expect(reviewForEntitlement(short, false)).toEqual({ review: short, reviewLocked: false });
  });

  it('no review at all is null and unlocked, for both tiers', () => {
    // A household that has not generated one yet must not see a paywall where
    // there is simply nothing to show.
    expect(reviewForEntitlement(null, false)).toEqual({ review: null, reviewLocked: false });
    expect(reviewForEntitlement(null, true)).toEqual({ review: null, reviewLocked: false });
  });
});
