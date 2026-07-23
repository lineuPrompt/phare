import { useTranslations } from 'next-intl';
import Link from 'next/link';
import AwaitingDatesNotice from '@/components/shared/AwaitingDatesNotice';
import type { CardCycleRemainder } from '@/lib/projectionHelpers';
import { DashboardSummary, formatCurrency } from './types';

export default function SnapshotCard({
  summary,
  locale,
  month,
  onPrevMonth,
  onNextMonth,
  isMaxMonth,
  isMinMonth,
  loading,
  unanchoredIncomeCount,
  unanchoredExpenseCount,
  projectedMonthEnd,
  carriedInAmount,
  cardEnvelopeRemainders,
}: {
  summary: DashboardSummary;
  locale: string;
  month: string;          // YYYY-MM (not YYYY-MM-01)
  onPrevMonth: () => void;
  onNextMonth: () => void;
  // True when `month` is the furthest month Phare has materialized data for
  // (the same 12-month rolling window Timeline uses) — disables forward nav
  // rather than letting it silently do nothing.
  isMaxMonth: boolean;
  // True when `month` is the earliest month with a real chequing balance
  // anchor (matches Timeline's own lower bound) — disables Prev past it
  // rather than showing a misleading empty/partial month.
  isMinMonth: boolean;
  // True only while an in-place month-switch fetch is running — the initial
  // page load has its own separate loading state (dashboard/page.tsx) and
  // never reaches this component while true.
  loading?: boolean;
  unanchoredIncomeCount?: number;
  unanchoredExpenseCount?: number;
  // Projection section (below the surplus/deficit row) — month-scoped to the
  // SAME `month` this card already navigates, so it lives inside this card
  // rather than as a separate tile elsewhere on the dashboard. null/undefined
  // hides the section entirely (no anchor, no timeline data yet, etc.) —
  // never a fabricated figure. See projectionHelpers.ts for the math; this
  // component only renders numbers it's handed.
  projectedMonthEnd?: number | null;
  carriedInAmount?: number;
  cardEnvelopeRemainders?: CardCycleRemainder[];
}) {
  const t = useTranslations('dashboard');
  const tNav = useTranslations('dashboard.snapshotNav');
  const tProjected = useTranslations('dashboard.projectedTile');
  const surplus = summary.netCashFlow >= 0;

  const showProjection =
    projectedMonthEnd !== undefined && projectedMonthEnd !== null &&
    carriedInAmount !== undefined && cardEnvelopeRemainders !== undefined;
  const noDataCardNames = (cardEnvelopeRemainders ?? []).filter((r) => r.noData).map((r) => r.cardName);

  const [y, m] = month.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA',
    { month: 'long', year: 'numeric' }
  );

  return (
    <div className="rounded-2xl bg-white p-4 sm:p-8" style={{ border: '1px solid #E5E7EB', opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h2 className="text-lg sm:text-xl font-bold" style={{ color: '#0F2044' }}>
          {t('snapshot')}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevMonth}
            disabled={isMinMonth}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default text-lg leading-none"
            style={{ color: '#6B7280' }}
            aria-label={isMinMonth ? tNav('outOfRange') : tNav('prev')}
            title={isMinMonth ? tNav('outOfRange') : tNav('prev')}
          >
            ‹
          </button>
          <Link
            href={`/${locale}/timeline?month=${month}`}
            className="text-sm font-medium capitalize hover:underline text-center"
            style={{ color: '#374151', minWidth: '90px' }}
            title={tNav('viewInTimeline')}
          >
            {monthLabel}
          </Link>
          <button
            onClick={onNextMonth}
            disabled={isMaxMonth}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default text-lg leading-none"
            style={{ color: '#6B7280' }}
            aria-label={isMaxMonth ? tNav('outOfRange') : tNav('next')}
            title={isMaxMonth ? tNav('outOfRange') : tNav('next')}
          >
            ›
          </button>
        </div>
      </div>

      <AwaitingDatesNotice
        incomeCount={unanchoredIncomeCount ?? 0}
        expenseCount={unanchoredExpenseCount ?? 0}
        href={`/${locale}/recurring`}
        className="block rounded-xl p-3 mb-3 text-sm hover:opacity-80 transition-opacity"
        style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}
      />

      {/* Three main buckets */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
        <div className="rounded-xl p-2 sm:p-4 min-w-0" style={{ background: '#F0FDFD' }}>
          <p className="text-[11px] sm:text-xs truncate" style={{ color: '#6B7280' }}>{t('income')}</p>
          <p className="text-sm sm:text-lg font-bold mt-1 truncate" style={{ color: '#16A34A' }}>
            {formatCurrency(summary.totalIncome, locale)}
          </p>
        </div>
        <div className="rounded-xl p-2 sm:p-4 min-w-0" style={{ background: '#FEF2F2' }}>
          <p className="text-[11px] sm:text-xs truncate" style={{ color: '#6B7280' }}>{t('expenses')}</p>
          <p className="text-sm sm:text-lg font-bold mt-1 truncate" style={{ color: '#DC2626' }}>
            {formatCurrency(summary.totalExpenses, locale)}
          </p>
        </div>
        <div className="rounded-xl p-2 sm:p-4 min-w-0" style={{ background: '#F0F9FF' }}>
          <p className="text-[11px] sm:text-xs truncate" style={{ color: '#6B7280' }}>{t('savings')}</p>
          <p className="text-sm sm:text-lg font-bold mt-1 truncate" style={{ color: '#0284C7' }}>
            {formatCurrency(summary.totalSavings, locale)}
          </p>
        </div>
      </div>

      {/* Net cash flow — remaining after income − expenses − savings */}
      <div
        className="rounded-xl p-3 sm:p-4"
        style={{ background: surplus ? '#F0FDF4' : '#FEF2F2' }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm" style={{ color: '#6B7280' }}>
            {surplus ? t('surplus') : t('deficit')}
          </p>
          <p className="text-lg sm:text-xl font-bold truncate" style={{ color: surplus ? '#16A34A' : '#DC2626' }}>
            {formatCurrency(summary.netCashFlow, locale)}
          </p>
        </div>
      </div>

      {/* This figure is this month's cash flow only — it never carries
          forward a prior month's leftover balance. The real running balance
          (which does) lives on Timeline; this note points there so the two
          numbers are never mistaken for the same thing. */}
      <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
        {t('monthOnlyNote')}{' '}
        <Link href={`/${locale}/timeline?month=${month}`} className="underline hover:no-underline">
          {t('viewRealBalance')}
        </Link>
      </p>

      {/* Projection section — same month as the header above, updates with
          the ‹ › nav for free since it's fed the same `month`-scoped props.
          Deliberately not its own green/red real-balance styling (DipTile/
          the surplus box above) — this is the app's first forward-looking
          estimate and must stay visually distinct from real balances. */}
      {showProjection && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E5E7EB' }}>
          <span
            className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
            style={{ background: '#EDE9FE', color: '#6D28D9' }}
          >
            {tProjected('badge')}
          </span>
          <p className="text-sm mb-1" style={{ color: '#6B7280' }}>{tProjected('label')}</p>
          <p className="text-2xl font-bold" style={{ color: '#4C1D95' }}>
            {formatCurrency(projectedMonthEnd as number, locale)}
          </p>

          <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
            {tProjected('basis', { amount: formatCurrency(carriedInAmount as number, locale) })}
          </p>

          {noDataCardNames.length > 0 && (
            <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
              {tProjected('unbudgeted', { cards: noDataCardNames.join(', ') })}
            </p>
          )}

          <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
            {tProjected('note')}{' '}
            <Link href={`/${locale}/timeline?month=${month}`} className="underline hover:no-underline">
              {tProjected('viewRealBalance')}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
