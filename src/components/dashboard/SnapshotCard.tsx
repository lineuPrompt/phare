import { useTranslations } from 'next-intl';
import Link from 'next/link';
import AwaitingDatesNotice from '@/components/shared/AwaitingDatesNotice';
import PlanChainTile from './PlanChainTile';
import type { PlanChainMonth } from '@/lib/planChainHelpers';
import { DashboardSummary, formatCurrency } from './types';

function monthLabelFor(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA',
    { month: 'long', year: 'numeric' }
  );
}

/**
 * One line of the snapshot's subtraction: an operator, a label, an amount.
 *
 * The operator sits in a fixed-width column so the signs line up vertically —
 * that alignment is what makes the block read as arithmetic rather than as a
 * list of unrelated figures, which was the original complaint.
 */
function SubtractionRow({
  label,
  operator,
  amount,
  locale,
  color,
  emphasis = false,
}: {
  label: string;
  operator: string;
  amount: number;
  locale: string;
  color: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 sm:px-4 py-2.5"
      style={
        emphasis
          ? { borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className="w-3 shrink-0 text-sm font-semibold text-center"
        style={{ color: '#9CA3AF' }}
      >
        {operator}
      </span>
      <p
        className={`flex-1 min-w-0 truncate ${emphasis ? 'text-sm font-semibold' : 'text-sm'}`}
        style={{ color: emphasis ? '#0F2044' : '#6B7280' }}
      >
        {label}
      </p>
      <p
        className={`shrink-0 tabular-nums font-bold ${emphasis ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'}`}
        style={{ color }}
      >
        {formatCurrency(amount, locale)}
      </p>
    </div>
  );
}

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
  currentMonth,
  isPastMonth,
  carriedInAmount,
  realCloseAmount,
  planMonth,
  isHorizonEnd,
  horizonLocked,
  horizonRemainingMonths,
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
  // Plan tile (below) — month-scoped to the SAME `month` this card already
  // navigates. undefined hides the section entirely — see PlanChainTile.
  currentMonth?: string;
  isPastMonth?: boolean;
  carriedInAmount?: number | null;
  // THE figure the plan must be read against (plan <= realCloseAmount) —
  // see PlanChainTile.
  realCloseAmount?: number | null;
  planMonth?: PlanChainMonth | null;
  isHorizonEnd?: boolean;
  // Pure pass-through to PlanChainTile — SnapshotCard makes no tier decision
  // of its own; the server already decided what this household receives.
  horizonLocked?: boolean;
  horizonRemainingMonths?: number;
}) {
  const t = useTranslations('dashboard');
  const tNav = useTranslations('dashboard.snapshotNav');
  const surplus = summary.netCashFlow >= 0;

  const monthLabel = monthLabelFor(month, locale);
  const showPlanTile = currentMonth !== undefined && isPastMonth !== undefined;

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

      {/* Subject line. This tile and the projection tile below treat the same
          borrowed dollars in opposite ways, which reads as a contradiction
          until each one says which question it answers. This is a FLOW —
          "did the month pay for itself" — so borrowed cash is excluded by
          definition. The projection tile is a STOCK and includes it. */}
      <p className="text-xs font-medium" style={{ color: '#6B7280' }}>
        {t('surplusQuestion')}
      </p>
      <p className="text-[11px] mb-2" style={{ color: '#9CA3AF' }}>
        {isPastMonth ? t('actualsForMonth', { month: monthLabel }) : t('actualsToDate')}
      </p>

      {/* THE SUBTRACTION, shown as a subtraction.

          Previously three tiles in a grid (income, expenses, savings) with
          debt payments as a purple footnote below. That did not add up on
          screen: netCashFlow subtracts FOUR terms, so in any month with a debt
          payment the three visible figures missed the surplus by exactly that
          amount — July 2026 showed 15,719.84 − 9,399.75 − 989.15 = 5,330.94
          against a displayed surplus of 4,330.94. The missing $1,000 was the
          footnote. Every term that the formula subtracts is now a row, in
          formula order, with its operator, so the arithmetic resolves for a
          reader.

          Debt payments appear only when non-zero: at zero the remaining rows
          already resolve exactly, so a permanent "− 0.00" would be noise
          rather than clarity. Borrowed cash is deliberately NOT a row here —
          it is not a term in this formula, which is precisely what the
          disclosure below it says. */}
      <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid #E5E7EB' }}>
        <SubtractionRow
          label={t('income')} operator="" amount={summary.totalIncome}
          locale={locale} color="#16A34A"
        />
        <SubtractionRow
          label={t('expenses')} operator="−" amount={summary.totalExpenses}
          locale={locale} color="#DC2626"
        />
        <SubtractionRow
          label={t('savings')} operator="−" amount={summary.totalSavings}
          locale={locale} color="#0284C7"
        />
        {summary.totalDebtPayments > 0 && (
          <SubtractionRow
            label={t('debtPayments')} operator="−" amount={summary.totalDebtPayments}
            locale={locale} color="#7C3AED"
          />
        )}
        <SubtractionRow
          label={surplus ? t('surplus') : t('deficit')}
          operator="="
          amount={summary.netCashFlow}
          locale={locale}
          color={surplus ? '#16A34A' : '#DC2626'}
          emphasis
        />
      </div>

      {/* Borrowed cash (a debt draw) is deliberately NOT a term in the
          subtraction above — a month that only "balanced" by borrowing must
          never read as a surplus month. Disclosed here with real visual
          weight (red, not a muted caption): a family scanning the number must
          not be able to miss that it was propped up by borrowing. This is the
          ONE alarm for these dollars — the projection tile states the same
          fact as a plain caption, deliberately (founder call, 2026-08-01; see
          PlanChainTile). */}
      {summary.totalBorrowed > 0 && (
        <div
          className="rounded-xl px-3 py-2.5 mt-2"
          style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}
        >
          <p className="text-sm font-semibold" style={{ color: '#B91C1C' }}>
            {t('borrowedNote', { amount: formatCurrency(summary.totalBorrowed, locale) })}
          </p>
        </div>
      )}

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

      {showPlanTile && (
        <PlanChainTile
          horizonLocked={horizonLocked}
          horizonRemainingMonths={horizonRemainingMonths}
          monthLabel={monthLabel}
          currentMonthLabel={monthLabelFor(currentMonth as string, locale)}
          isPastMonth={isPastMonth as boolean}
          planMonth={planMonth ?? null}
          isHorizonEnd={isHorizonEnd ?? false}
          carriedInAmount={carriedInAmount ?? null}
          realCloseAmount={realCloseAmount ?? null}
          totalBorrowed={summary.totalBorrowed}
          locale={locale}
          recurringHref={`/${locale}/recurring`}
          timelineHref={`/${locale}/timeline?month=${month}`}
        />
      )}
    </div>
  );
}
