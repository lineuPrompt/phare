import { describe, it, expect } from 'vitest';
import { planPathGeometry, formatPlanDates, planPathMonthLabel, sentenceStart, planCardBasisKey } from '../planDisplay';

describe('planPathGeometry', () => {
  it('puts the zero line where positive and negative bars meet', () => {
    // 2be22642's May–Jul 2027 month-ends.
    const { zero, bars } = planPathGeometry([-637.84, 727.03, 5.57]);
    const span = 727.03 + 637.84;
    expect(zero).toBeCloseTo(727.03 / span, 10);
    expect(bars[0]).toEqual({ top: zero, height: 637.84 / span, negative: true });
    expect(bars[1]).toEqual({ top: 0, height: 727.03 / span, negative: false });
    expect(bars[2].top + bars[2].height).toBeCloseTo(zero, 10); // a positive bar stands ON the zero line
  });

  it('an all-positive path keeps zero at the bottom; an all-negative one at the top', () => {
    expect(planPathGeometry([100, 50]).zero).toBe(1);
    expect(planPathGeometry([-100, -50]).zero).toBe(0);
    expect(planPathGeometry([-100, -50]).bars[1]).toEqual({ top: 0, height: 0.5, negative: true });
  });

  it('a flat zero path draws no bars rather than dividing by zero', () => {
    expect(planPathGeometry([0, 0])).toEqual({ zero: 1, bars: [{ top: 1, height: 0, negative: false }, { top: 1, height: 0, negative: false }] });
  });
});

describe('formatPlanDates', () => {
  const MAY = ['2027-05-03', '2027-05-17', '2027-05-31'];
  it('en: month first, days listed', () => {
    expect(formatPlanDates(MAY, 'en')).toBe('May 3, 17, 31');
  });
  it('fr: days first, "et" before the last, month lower-case', () => {
    expect(formatPlanDates(MAY, 'fr')).toBe('3, 17 et 31 mai');
    expect(formatPlanDates(['2027-08-09'], 'fr')).toBe('9 août');
  });
  it('no dates, no text', () => {
    expect(formatPlanDates([], 'en')).toBe('');
  });
});

describe('planPathMonthLabel', () => {
  it('one letter per month, in each language', () => {
    expect(planPathMonthLabel('2027-05', 'en')).toBe('M');
    expect(planPathMonthLabel('2027-08', 'fr')).toBe('A');
  });
});

describe('sentenceStart', () => {
  it('capitalises a French month that opens a sentence; English is unchanged', () => {
    expect(sentenceStart('mai 2027', 'fr')).toBe('Mai 2027');
    expect(sentenceStart('août 2027', 'fr')).toBe('Août 2027');
    expect(sentenceStart('May 2027', 'en')).toBe('May 2027');
  });
});

describe('planCardBasisKey', () => {
  it('one key per basis; a running statement is "so far", a closed one is not', () => {
    expect(planCardBasisKey('budget', false)).toBe('cardBudget');
    expect(planCardBasisKey('max', false)).toBe('cardMax');
    expect(planCardBasisKey('posted', false)).toBe('cardPosted');
    expect(planCardBasisKey('actual', true)).toBe('cardSoFar');
    expect(planCardBasisKey('actual', false)).toBe('cardClosed');
  });
});
