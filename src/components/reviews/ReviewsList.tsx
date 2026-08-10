'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import UpgradeButton from '@/components/billing/UpgradeButton';
import { formatCurrency, formatDate } from '@/components/dashboard/types';
import { formatArchiveMonth, type ReviewArchive, type ArchiveLetter } from '@/lib/reviewArchive';

// ---------------------------------------------------------------------------
// The Reviews archive.
//
// PRESENTATION ONLY, in the same sense ReviewCard is: a free household's
// `review` strings arrived already truncated from GET /api/reviews, so the lock
// UI below reveals nothing when removed. It cannot leak what it was never sent.
//
// Letters are collapsed by default and open one at a time. An archive of a
// dozen four-paragraph letters rendered open is a wall of prose with no way to
// find anything in it; the month, the date and the ledger figure are what the
// household scans, and the letter is what they choose to read.
// ---------------------------------------------------------------------------

type Loaded = ReviewArchive & { isPro: boolean };

/** The ledger figure beside a month. Null renders as a dash, never as $0. */
function NetFigure({ value, locale }: { value: number | null; locale: string }) {
  const t = useTranslations('reviews');

  if (value === null) {
    return (
      <span className="text-sm" style={{ color: '#9CA3AF' }} title={t('noFigureHint')}>
        —
      </span>
    );
  }

  const positive = value >= 0;
  return (
    <span
      className="text-sm font-semibold tabular-nums"
      style={{ color: positive ? '#0F766E' : '#B91C1C' }}
    >
      {positive ? '+' : ''}{formatCurrency(value, locale)}
    </span>
  );
}

function LetterBody({
  letter,
  locale,
}: {
  letter: ArchiveLetter;
  locale: string;
}) {
  const t = useTranslations('reviews');

  return (
    <div className="px-5 pb-5 pt-1">
      {letter.topRecommendation && (
        <div
          className="rounded-xl p-4 mb-4"
          style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#0F766E' }}>
            {t('topRecommendation')}
          </p>
          <p className="text-sm" style={{ color: '#0F766E' }}>{letter.topRecommendation}</p>
        </div>
      )}

      {letter.review ? (
        <div style={{ color: '#374151' }}>
          {letter.review.split('\n').filter(Boolean).map((paragraph, i) => (
            <p key={i} className="mb-4 text-sm leading-relaxed">{paragraph}</p>
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('letterUnavailable')}</p>
      )}

      {letter.reviewLocked && (
        <div
          className="rounded-xl p-5 mt-2"
          style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}
        >
          <p className="font-semibold text-sm mb-1" style={{ color: '#0F766E' }}>
            {t('lockedTitle')}
          </p>
          <p className="text-sm mb-4" style={{ color: '#0F766E' }}>{t('lockedBody')}</p>
          <UpgradeButton />
        </div>
      )}

      <p className="text-xs mt-4" style={{ color: '#9CA3AF' }}>
        {t('writtenOn', { date: formatDate(letter.createdAt, locale) })}
      </p>
    </div>
  );
}

/** One expandable entry. `title` is the month, "Earlier" date, or plan label. */
function LetterRow({
  letter,
  title,
  subtitle,
  figure,
  locale,
  open,
  onToggle,
}: {
  letter: ArchiveLetter;
  title: string;
  subtitle?: string;
  figure?: number | null;
  locale: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('reviews');

  return (
    <div className="rounded-2xl bg-white overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold" style={{ color: '#0F2044' }}>{title}</span>
            {letter.reviewLocked && <span className="text-xs">🔒</span>}
          </span>
          {subtitle && (
            <span className="block text-xs mt-0.5" style={{ color: '#9CA3AF' }}>{subtitle}</span>
          )}
        </span>

        {figure !== undefined && <NetFigure value={figure} locale={locale} />}

        <span className="text-sm ml-1" style={{ color: '#6B7280' }} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
        <span className="sr-only">{open ? t('collapse') : t('expand')}</span>
      </button>

      {open && <LetterBody letter={letter} locale={locale} />}
    </div>
  );
}

export default function ReviewsList({ locale }: { locale: string }) {
  const t = useTranslations('reviews');

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/reviews')
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? 'load_failed');
        return json as Loaded;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        // Open the newest letter automatically. It is the one they came for,
        // and an archive that opens fully collapsed makes the page look empty.
        const newest = json.months[0]?.letter.id ?? json.startingPlan?.id ?? null;
        setOpenId(newest);
      })
      .catch(() => { if (!cancelled) setError(t('loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [t]);

  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  if (loading) {
    return <p className="text-sm" style={{ color: '#6B7280' }}>{t('loading')}</p>;
  }

  if (error) {
    return <p className="text-sm" style={{ color: '#B91C1C' }}>{error}</p>;
  }

  if (!data) return null;

  // Narrowed once here so the JSX below can close over it without a non-null
  // assertion (TS narrowing does not survive into the onToggle callback).
  const startingPlan = data.startingPlan;

  const isEmpty = data.months.length === 0 && !data.startingPlan;

  if (isEmpty) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center" style={{ border: '1px solid #E5E7EB' }}>
        <p className="text-4xl mb-3" aria-hidden="true">✉️</p>
        <h2 className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('emptyTitle')}</h2>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ---- One letter per month --------------------------------------- */}
      {data.months.length > 0 && (
        <section className="space-y-3">
          {data.months.map((entry) => (
            <LetterRow
              key={entry.month}
              letter={entry.letter}
              title={formatArchiveMonth(entry.month, locale)}
              figure={entry.netCashFlow}
              locale={locale}
              open={openId === entry.letter.id}
              onToggle={() => toggle(entry.letter.id)}
            />
          ))}
        </section>
      )}

      {/* ---- The cold-start baseline ------------------------------------ */}
      {startingPlan && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
              {t('startingPlanTitle')}
            </h2>
            <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>{t('startingPlanHint')}</p>
          </div>
          <LetterRow
            letter={startingPlan}
            title={t('startingPlanTitle')}
            subtitle={formatDate(startingPlan.createdAt, locale)}
            locale={locale}
            open={openId === startingPlan.id}
            onToggle={() => toggle(startingPlan.id)}
          />
        </section>
      )}
    </div>
  );
}
