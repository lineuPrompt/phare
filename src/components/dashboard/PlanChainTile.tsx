'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import AwaitingDatesNotice from '@/components/shared/AwaitingDatesNotice';
import type { PlanChainMonth, CardCostBasis } from '@/lib/planChainHelpers';
import { formatCurrency } from './types';

function basisKey(basis: CardCostBasis): 'basisActual' | 'basisBudget' | 'basisMax' | 'basisPosted' {
  switch (basis) {
    case 'actual': return 'basisActual';
    case 'budget': return 'basisBudget';
    case 'max': return 'basisMax';
    case 'posted': return 'basisPosted';
  }
}

// Replaces the retired single-month "Projected month-end" tile. Lives on
// the dashboard snapshot, follows the SAME month nav as the rest of the
// card. The real carriedIn figure is shown first, as its own truthful
// caption — the chain figure sits below it, clearly labeled by the
// question it answers, never stacked as if carriedIn + flow = chain (see
// planChainHelpers.ts's INVARIANT note for why they're allowed to diverge).
export default function PlanChainTile({
  monthLabel,
  currentMonthLabel,
  isPastMonth,
  planMonth,
  isHorizonEnd,
  carriedInAmount,
  variableEstimateMonthly,
  insufficientHistory,
  totalBorrowed,
  locale,
  recurringHref,
  timelineHref,
}: {
  monthLabel: string;
  currentMonthLabel: string;
  isPastMonth: boolean;
  // The chain entry for `month`, or null when it's out of the fetched
  // plan window (currentMonth..currentMonth+11) — never fabricated.
  planMonth: PlanChainMonth | null;
  isHorizonEnd: boolean;
  // The real balance carried in from before `month` (buildMonthView's own
  // opensAt) — truthful, independent of the chain, shown for comparison.
  carriedInAmount: number | null;
  variableEstimateMonthly: number | null;
  insufficientHistory: boolean;
  totalBorrowed: number;
  locale: string;
  recurringHref: string;
  timelineHref: string;
}) {
  const t = useTranslations('dashboard.plan');

  if (isPastMonth) {
    return (
      <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E5E7EB' }}>
        <span
          className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
          style={{ background: '#EDE9FE', color: '#6D28D9' }}
        >
          {t('badge')}
        </span>
        <p className="text-sm" style={{ color: '#6B7280' }}>
          {t('pastMonth', { currentMonth: currentMonthLabel, month: monthLabel })}
        </p>
      </div>
    );
  }

  // Out of the fetched plan window (no anchor yet, data still loading) —
  // never a fabricated figure, hide entirely.
  if (!planMonth) return null;

  const positive = planMonth.balance >= 0;

  return (
    <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E5E7EB' }}>
      <span
        className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
        style={{ background: '#EDE9FE', color: '#6D28D9' }}
      >
        {t('badge')}
      </span>

      {carriedInAmount !== null && (
        <p className="text-xs mb-2" style={{ color: '#9CA3AF' }}>
          {t('carriedIn', { month: monthLabel, amount: formatCurrency(carriedInAmount, locale) })}
        </p>
      )}

      <p className="text-sm mb-1" style={{ color: '#6B7280' }}>
        {t(planMonth.isPartialMonth ? 'labelRemainder' : 'labelFull', { month: monthLabel })}
      </p>
      <p className="text-2xl font-bold" style={{ color: positive ? '#4C1D95' : '#B91C1C' }}>
        {formatCurrency(planMonth.balance, locale)}
      </p>

      {planMonth.cardCost.length > 0 && (
        <ul className="mt-3 space-y-1">
          {planMonth.cardCost.map((c) => (
            <li key={c.cardId} className="text-xs" style={{ color: '#6D28D9' }}>
              {t(basisKey(c.basis), { card: c.cardName, amount: formatCurrency(c.amount, locale) })}
            </li>
          ))}
        </ul>
      )}

      {/* Same prominence as the surplus box above (SnapshotCard) — the cash
          really is in chequing (that's why it's still counted here), but
          the reader needs the identical "this was borrowed" signal. */}
      {totalBorrowed > 0 && (
        <div
          className="rounded-xl px-3 py-2.5 mt-2"
          style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}
        >
          <p className="text-sm font-semibold" style={{ color: '#B91C1C' }}>
            {t('borrowedNote', { amount: formatCurrency(totalBorrowed, locale) })}
          </p>
        </div>
      )}

      {variableEstimateMonthly !== null && (
        <p className="text-xs mt-2" style={{ color: '#6D28D9' }}>
          {t('variableEstimate', { amount: formatCurrency(variableEstimateMonthly, locale) })}
        </p>
      )}

      {insufficientHistory && (
        <p className="text-xs mt-2" style={{ color: '#92400E' }}>{t('insufficientHistory')}</p>
      )}

      <AwaitingDatesNotice
        incomeCount={planMonth.unanchoredIncomeCount}
        expenseCount={planMonth.unanchoredExpenseCount}
        href={recurringHref}
        className="block text-xs mt-2 hover:underline"
        style={{ color: '#92400E' }}
      />

      <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
        {t('note')}{' '}
        <Link href={timelineHref} className="underline hover:no-underline">
          {t('viewRealBalance')}
        </Link>
      </p>

      {isHorizonEnd && (
        <p className="text-xs mt-2 font-medium" style={{ color: '#6D28D9' }}>{t('horizonEnd')}</p>
      )}
    </div>
  );
}
