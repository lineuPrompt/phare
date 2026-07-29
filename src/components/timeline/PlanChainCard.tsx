'use client';

import { useTranslations } from 'next-intl';
import AwaitingDatesNotice from '@/components/shared/AwaitingDatesNotice';
import type { PlanChainMonth, CardCostBasis } from '@/lib/planChainHelpers';
import { formatCurrency } from '@/components/expenses/types';

function basisKey(basis: CardCostBasis): 'basisActual' | 'basisBudget' | 'basisMax' | 'basisPosted' {
  switch (basis) {
    case 'actual': return 'basisActual';
    case 'budget': return 'basisBudget';
    case 'max': return 'basisMax';
    case 'posted': return 'basisPosted';
  }
}

// The chained 12-month plan ("if every month goes as budgeted, where do I
// land") — deliberately distinct from RemainingCashStrip's real balance
// above it, never presented as if the two arithmetically resolve into each
// other. See planChainHelpers.ts for the math this only renders.
export default function PlanChainCard({
  month,
  monthLabel,
  isHorizonEnd,
  variableEstimateMonthly,
  insufficientHistory,
  locale,
  recurringHref,
}: {
  month: PlanChainMonth;
  monthLabel: string;
  isHorizonEnd: boolean;
  variableEstimateMonthly: number;
  insufficientHistory: boolean;
  locale: string;
  recurringHref: string;
}) {
  const t = useTranslations('timeline.plan');
  const positive = month.balance >= 0;

  // A card whose basis is 'posted' contributed $0 to this month's math (see
  // the MONTH-1 BOUNDARY note in planChainHelpers.ts) — still listed, so it
  // never looks like a card silently dropped off the plan.
  return (
    <div className="rounded-2xl p-6" style={{ background: '#F5F3FF', border: '2px solid #DDD6FE' }}>
      <span
        className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
        style={{ background: '#EDE9FE', color: '#6D28D9' }}
      >
        {t('badge')}
      </span>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold" style={{ color: '#4C1D95' }}>
          {t('label', { month: monthLabel })}
        </span>
        <span className="text-2xl font-bold" style={{ color: positive ? '#4C1D95' : '#B91C1C' }}>
          {formatCurrency(month.balance, locale)}
        </span>
      </div>

      {month.cardCost.length > 0 && (
        <ul className="mt-3 space-y-1">
          {month.cardCost.map((c) => (
            <li key={c.cardId} className="text-xs" style={{ color: '#6D28D9' }}>
              {t(basisKey(c.basis), { card: c.cardName, amount: formatCurrency(c.amount, locale) })}
            </li>
          ))}
        </ul>
      )}

      {variableEstimateMonthly > 0 && (
        <p className="text-xs mt-2" style={{ color: '#6D28D9' }}>
          {t('variableEstimate', { amount: formatCurrency(variableEstimateMonthly, locale) })}
        </p>
      )}

      {insufficientHistory && (
        <p className="text-xs mt-2" style={{ color: '#92400E' }}>{t('insufficientHistory')}</p>
      )}

      <AwaitingDatesNotice
        incomeCount={month.unanchoredIncomeCount}
        expenseCount={month.unanchoredExpenseCount}
        href={recurringHref}
        className="block text-xs mt-2 hover:underline"
        style={{ color: '#92400E' }}
      />

      <p className="text-xs mt-3" style={{ color: '#9CA3AF' }}>{t('note')}</p>

      {isHorizonEnd && (
        <p className="text-xs mt-2 font-medium" style={{ color: '#6D28D9' }}>{t('horizonEnd')}</p>
      )}
    </div>
  );
}
