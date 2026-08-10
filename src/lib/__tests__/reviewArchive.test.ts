import { describe, it, expect } from 'vitest';
import {
  groupReviewArchive,
  pickStartingPlan,
  extractLetter,
  formatArchiveMonth,
  monthsNeedingFigures,
  type ArchiveConversation,
} from '../reviewArchive';

// ---------------------------------------------------------------------------
// The archive's job is to keep three kinds of row apart. Filing one under the
// wrong heading is the failure that matters: a letter shown under a month it
// does not describe is wrong in a way the reader cannot detect.
// ---------------------------------------------------------------------------

const LONG_REVIEW = `${'Your month went well. '.repeat(40)}`;

function conv(over: Partial<ArchiveConversation> & { id: string }): ArchiveConversation {
  return {
    type: 'monthly_review',
    review_month: null,
    created_at: '2026-08-01T07:00:00Z',
    messages: [
      { role: 'assistant', type: 'top_recommendation', content: 'Move $200.' },
      { role: 'assistant', type: 'monthly_review', content: 'A short letter.' },
    ],
    ...over,
  };
}

describe('extractLetter', () => {
  it('pulls both message bodies out', () => {
    const letter = extractLetter(conv({ id: 'a' }), true);
    expect(letter.topRecommendation).toBe('Move $200.');
    expect(letter.review).toBe('A short letter.');
    expect(letter.reviewLocked).toBe(false);
  });

  it('truncates for a free household and flags the lock', () => {
    const letter = extractLetter(
      conv({
        id: 'a',
        messages: [{ type: 'monthly_review', content: LONG_REVIEW }],
      }),
      false
    );
    expect(letter.reviewLocked).toBe(true);
    expect(letter.review!.length).toBeLessThan(LONG_REVIEW.length);
  });

  it('never truncates for Pro', () => {
    const letter = extractLetter(
      conv({ id: 'a', messages: [{ type: 'monthly_review', content: LONG_REVIEW }] }),
      true
    );
    // Verbatim — the Pro path hands back exactly what was stored, untrimmed.
    expect(letter.review).toBe(LONG_REVIEW);
    expect(letter.reviewLocked).toBe(false);
  });

  it('survives a row whose messages are not an array', () => {
    const letter = extractLetter(conv({ id: 'a', messages: null }), true);
    expect(letter.review).toBeNull();
    expect(letter.topRecommendation).toBeNull();
  });
});

describe('groupReviewArchive', () => {
  it('separates monthed letters, unmonthed letters and the starting plan', () => {
    const archive = groupReviewArchive(
      [
        conv({ id: 'jul', review_month: '2026-07', created_at: '2026-08-01T07:00:00Z' }),
        conv({ id: 'jun', review_month: '2026-06', created_at: '2026-07-01T07:00:00Z' }),
        conv({ id: 'adhoc', created_at: '2026-07-15T12:00:00Z' }),
        conv({ id: 'plan', type: 'onboarding', created_at: '2026-06-02T09:00:00Z' }),
      ],
      { isPro: true }
    );

    expect(archive.months.map((m) => m.month)).toEqual(['2026-07', '2026-06']);
    expect(archive.earlier.map((l) => l.id)).toEqual(['adhoc']);
    expect(archive.startingPlan?.id).toBe('plan');
  });

  it('NEVER infers a month for an unmonthed letter', () => {
    // A refresh generated in August says nothing reliable about which month it
    // covers. Filing it under 2026-07 would be a guess the reader cannot check.
    const archive = groupReviewArchive(
      [conv({ id: 'adhoc', created_at: '2026-08-14T12:00:00Z' })],
      { isPro: true }
    );
    expect(archive.months).toEqual([]);
    expect(archive.earlier.map((l) => l.id)).toEqual(['adhoc']);
  });

  it('keeps the newest letter for a month and makes older ones reachable', () => {
    const archive = groupReviewArchive(
      [
        conv({ id: 'old', review_month: '2026-07', created_at: '2026-08-01T07:00:00Z' }),
        conv({ id: 'new', review_month: '2026-07', created_at: '2026-08-03T11:00:00Z' }),
      ],
      { isPro: true }
    );

    expect(archive.months).toHaveLength(1);
    expect(archive.months[0].latest.id).toBe('new');
    expect(archive.months[0].earlier.map((l) => l.id)).toEqual(['old']);
  });

  it('drops an in-flight claim rather than rendering a dated entry with nothing in it', () => {
    // The cron inserts its claim BEFORE generating, so `messages: []` is a real
    // transient state, not corruption.
    const archive = groupReviewArchive(
      [conv({ id: 'claim', review_month: '2026-07', messages: [] })],
      { isPro: true }
    );
    expect(archive.months).toEqual([]);
  });

  it('attaches the code-computed figure, and null is not zero', () => {
    const archive = groupReviewArchive(
      [
        conv({ id: 'jul', review_month: '2026-07' }),
        conv({ id: 'jun', review_month: '2026-06' }),
      ],
      { isPro: true, figures: { '2026-07': -420.5 } }
    );

    const jul = archive.months.find((m) => m.month === '2026-07');
    const jun = archive.months.find((m) => m.month === '2026-06');
    expect(jul?.netCashFlow).toBe(-420.5);
    // No figure supplied — must stay null so the UI shows a dash, not "$0".
    expect(jun?.netCashFlow).toBeNull();
  });

  it('applies the paywall to every letter it returns, onboarding included', () => {
    const long = [{ type: 'monthly_review', content: LONG_REVIEW }];
    const archive = groupReviewArchive(
      [
        conv({ id: 'jul', review_month: '2026-07', messages: long }),
        conv({ id: 'adhoc', messages: long }),
        conv({ id: 'plan', type: 'onboarding', messages: long, created_at: '2026-01-01T00:00:00Z' }),
      ],
      { isPro: false }
    );

    expect(archive.months[0].latest.reviewLocked).toBe(true);
    expect(archive.earlier[0].reviewLocked).toBe(true);
    // Matches the dashboard, which truncates whatever letter it shows —
    // onboarding included. Un-gating it here would be a paywall hole.
    expect(archive.startingPlan?.reviewLocked).toBe(true);
  });
});

describe('pickStartingPlan', () => {
  it('picks the EARLIEST onboarding letter as the cold-start baseline', () => {
    const archive = groupReviewArchive(
      [
        conv({ id: 'first', type: 'onboarding', created_at: '2026-01-05T10:00:00Z' }),
        conv({ id: 'reupload', type: 'onboarding', created_at: '2026-05-20T10:00:00Z' }),
      ],
      { isPro: true }
    );

    expect(archive.startingPlan?.id).toBe('first');
    // The re-upload is a real letter and must not vanish.
    expect(archive.earlier.map((l) => l.id)).toEqual(['reupload']);
  });

  it('returns null when the household has no onboarding letter', () => {
    expect(pickStartingPlan([]).startingPlan).toBeNull();
  });
});

describe('formatArchiveMonth', () => {
  it('renders a readable month in both locales', () => {
    expect(formatArchiveMonth('2026-08', 'en')).toMatch(/August/);
    expect(formatArchiveMonth('2026-08', 'fr')).toMatch(/août/);
  });

  it('does not shift the month across a timezone boundary', () => {
    // Built from local Y/M/D parts, not parsed as UTC midnight — otherwise a
    // negative-offset runner renders January 2026 as December 2025.
    expect(formatArchiveMonth('2026-01', 'en')).toMatch(/January 2026/);
  });

  it('passes a malformed month through rather than inventing a date', () => {
    expect(formatArchiveMonth('nonsense', 'en')).toBe('nonsense');
  });
});

describe('monthsNeedingFigures', () => {
  it('lists each monthed review once, ascending, ignoring onboarding', () => {
    expect(
      monthsNeedingFigures([
        conv({ id: 'a', review_month: '2026-07' }),
        conv({ id: 'b', review_month: '2026-06' }),
        conv({ id: 'c', review_month: '2026-07' }),
        conv({ id: 'd', type: 'onboarding', review_month: '2026-05' }),
        conv({ id: 'e' }),
      ])
    ).toEqual(['2026-06', '2026-07']);
  });
});
