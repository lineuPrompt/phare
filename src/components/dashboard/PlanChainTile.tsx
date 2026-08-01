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
// card. realCloseAmount is shown first — it's THE figure the chain must be
// read against (planChainHelpers.ts's INVARIANT: for the current month,
// plan <= real close, and equals it exactly once every card cycle has
// closed). carriedInAmount (the month's opening balance) is kept only as
// secondary context. Neither is stacked as if it arithmetically resolves
// into the chain figure below it — each is labeled by the question it
// answers.
export default function PlanChainTile({
  monthLabel,
  currentMonthLabel,
  isPastMonth,
  planMonth,
  isHorizonEnd,
  carriedInAmount,
  realCloseAmount,
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
  // The real OPENING balance for `month` (buildMonthView's opensAt) —
  // secondary context only.
  carriedInAmount: number | null;
  // THE figure the plan must be read against (buildMonthView's closesAt).
  realCloseAmount: number | null;
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

      {realCloseAmount !== null && (
        <p className="text-xs" style={{ color: '#6B7280' }}>
          {t('closesAt', { month: monthLabel, amount: formatCurrency(realCloseAmount, locale) })}
        </p>
      )}
      {carriedInAmount !== null && (
        <p className="text-xs mb-2" style={{ color: '#9CA3AF' }}>
          {t('carriedIn', { month: monthLabel, amount: formatCurrency(carriedInAmount, locale) })}
        </p>
      )}

      {/* Subject line — see SnapshotCard's. This is a STOCK ("how much money
          will actually be there"), so borrowed cash IS counted: it really is
          in chequing. Saying which question this answers is what stops the
          different treatment reading as an inconsistency. */}
      <p className="text-xs font-medium" style={{ color: '#6B7280' }}>
        {t('question')}
      </p>
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

      {/* BORROWED DISCLOSURE — deliberately a caption here, not a red alarm.
          Superseded decision (founder call, 2026-08-01): this used to be a red
          box at "the same prominence as the surplus box above", on the
          reasoning that the reader needs an identical "this was borrowed"
          signal. In use that backfired. The same $2,000 appeared twice on one
          screen in two identical red boxes with opposite verbs — "NOT counted
          in this surplus" here vs "Includes ... borrowed" there — and read as
          a contradiction rather than a warning. ("o que nao fecha pra mim.")

          The SIGNAL stays and is unconditional; only its alarm level changes.
          A warning that gets read as noise protects nobody, and the two tiles
          are not in conflict — they answer different questions, which the
          subject lines now say out loud. One alarm, on the snapshot, where
          borrowing genuinely qualifies the month. Here it qualifies a balance
          that really is in chequing, so it sits in the tile's own colour,
          subordinate to the number it describes.

          Do not restore the red box without also removing the snapshot's —
          two alarms for one dollar amount is what caused the confusion. */}
      {totalBorrowed > 0 && (
        <p className="text-sm font-semibold mt-2" style={{ color: '#6D28D9' }}>
          {t('borrowedNote', { amount: formatCurrency(totalBorrowed, locale) })}
        </p>
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
