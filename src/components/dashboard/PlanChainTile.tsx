'use client';

import { useTranslations } from 'next-intl';
import AwaitingDatesNotice from '@/components/shared/AwaitingDatesNotice';
import type { PlanChainMonthPayload, CardStatementHistory } from '@/lib/planChainHelpers';
import { FuturePlanSum, PlanWhyLine, PlanPathChart, StatementCheck } from './PlanFutureParts';
import UpgradeButton from '@/components/billing/UpgradeButton';

// The Plan card on the dashboard snapshot, following the same month nav.
//
// ONE BASIS, THE PLAN (2026-11-14). The current month and every month after
// it show the plan as a sum that adds up (FuturePlanSum): the current month
// starts from today's real balance and adds what is still scheduled; a future
// month starts where the month before it ends. The "real balance at close /
// carried in" lines are gone: for any month still running or ahead, they left
// out card statements that have not closed yet, and the plan looked wrong
// beside them (docs/tickets/future-month-real-close-omits-card-cost.md).
// Borrowed cash is not a separate caption any more — it is the sum's own
// "From savings / borrowed" row.
export default function PlanChainTile({
  monthLabel,
  currentMonthLabel,
  isPastMonth,
  planMonth,
  isHorizonEnd,
  horizonLocked = false,
  horizonRemainingMonths = 0,
  locale,
  recurringHref,
  pathMonths = [],
  statementHistory = [],
}: {
  monthLabel: string;
  currentMonthLabel: string;
  isPastMonth: boolean;
  // The chain entry for `month`, or null when it's out of the fetched
  // plan window (currentMonth..currentMonth+11) — never fabricated.
  planMonth: PlanChainMonthPayload | null;
  isHorizonEnd: boolean;
  // Set when this month EXISTS in the computed window but was withheld from
  // a free household. Distinct from planMonth being null for the ordinary
  // reason (genuinely outside the window), which must still render nothing.
  horizonLocked?: boolean;
  horizonRemainingMonths?: number;
  locale: string;
  recurringHref: string;
  // Every month the household can see, for the month-end path.
  pathMonths?: { month: string; balance: number }[];
  statementHistory?: CardStatementHistory[];
}) {
  const t = useTranslations('dashboard.plan');

  if (isPastMonth) {
    return (
      // Same dark treatment as the live state below — otherwise stepping back
      // a month flips this section from a dark card to plain text on white.
      <div className="mt-4 rounded-2xl p-4 sm:p-6" style={{ background: '#0F2044' }}>
        <span
          className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
          style={{ background: 'rgba(42,191,191,0.15)', color: '#2ABFBF' }}
        >
          {t('badge')}
        </span>
        <p className="text-sm" style={{ color: '#94A3B8' }}>
          {t('pastMonth', { currentMonth: currentMonthLabel, month: monthLabel })}
        </p>
      </div>
    );
  }

  // Withheld by the tier, not absent. Navigating forward and finding the
  // projection silently gone reads as a bug; saying what is behind it reads as
  // a tier. Deliberately an invitation and not a wall — it names the thing
  // ("9 more months of projection") and links to the plan. No countdown, no
  // urgency, nothing that pressures a household looking at their own money.
  if (!planMonth && horizonLocked) {
    return (
      <div className="mt-4 rounded-2xl p-4 sm:p-6" style={{ background: '#0F2044' }}>
        <span
          className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
          style={{ background: 'rgba(42,191,191,0.15)', color: '#2ABFBF' }}
        >
          {t('badge')}
        </span>
        <p className="text-sm mb-4" style={{ color: '#94A3B8' }}>
          {t('horizonLocked', { count: horizonRemainingMonths })}
        </p>
        <UpgradeButton />
      </div>
    );
  }

  // Out of the fetched plan window (no anchor yet, data still loading) —
  // never a fabricated figure, hide entirely.
  if (!planMonth) return null;

  return (
    <div className="mt-4 rounded-2xl p-4 sm:p-6" style={{ background: '#0F2044' }}>
      <span
        className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
        style={{ background: 'rgba(42,191,191,0.15)', color: '#2ABFBF' }}
      >
        {t('badge')}
      </span>

      <p className="text-sm font-medium" style={{ color: '#2ABFBF' }}>
        {t('future.question')}
      </p>
      <p className="text-sm" style={{ color: '#94A3B8' }}>
        {planMonth.isPartialMonth
          ? t('future.labelRemainder', { month: monthLabel })
          : t('future.label')}
      </p>
      <FuturePlanSum planMonth={planMonth} monthLabel={monthLabel} locale={locale} />
      <PlanWhyLine planMonth={planMonth} monthLabel={monthLabel} locale={locale} />

      <AwaitingDatesNotice
        incomeCount={planMonth.unanchoredIncomeCount}
        expenseCount={planMonth.unanchoredExpenseCount}
        href={recurringHref}
        className="block text-xs mt-2 hover:underline"
        style={{ color: '#FCD34D' }}
      />

      <PlanPathChart months={pathMonths} selectedMonth={planMonth.month} locale={locale} />
      <StatementCheck history={statementHistory} cardCost={planMonth.cardCost} locale={locale} />

      {/* No Timeline link here: the snapshot above carries it for the
          current month, and the month name in the card's header links there
          for every month. */}
      <p className="text-xs mt-2" style={{ color: '#94A3B8' }}>
        {t('note')}
      </p>

      {isHorizonEnd && (
        <p className="text-xs mt-2 font-medium" style={{ color: '#C4B5FD' }}>{t('horizonEnd')}</p>
      )}
    </div>
  );
}
