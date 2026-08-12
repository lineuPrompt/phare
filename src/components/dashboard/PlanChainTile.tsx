'use client';

import { useTranslations } from 'next-intl';
import AwaitingDatesNotice from '@/components/shared/AwaitingDatesNotice';
import type { PlanChainMonth, CardCostBasis } from '@/lib/planChainHelpers';
import { formatCurrency } from './types';
import UpgradeButton from '@/components/billing/UpgradeButton';

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
  horizonLocked = false,
  horizonRemainingMonths = 0,
  carriedInAmount,
  realCloseAmount,
  totalBorrowed,
  locale,
  recurringHref,
}: {
  monthLabel: string;
  currentMonthLabel: string;
  isPastMonth: boolean;
  // The chain entry for `month`, or null when it's out of the fetched
  // plan window (currentMonth..currentMonth+11) — never fabricated.
  planMonth: PlanChainMonth | null;
  isHorizonEnd: boolean;
  // Set when this month EXISTS in the computed window but was withheld from
  // a free household. Distinct from planMonth being null for the ordinary
  // reason (genuinely outside the window), which must still render nothing.
  horizonLocked?: boolean;
  horizonRemainingMonths?: number;
  // The real OPENING balance for `month` (buildMonthView's opensAt) —
  // secondary context only.
  carriedInAmount: number | null;
  // THE figure the plan must be read against (buildMonthView's closesAt).
  realCloseAmount: number | null;
  totalBorrowed: number;
  locale: string;
  recurringHref: string;
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
  // urgency, nothing that pressures a family looking at their own money.
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

  const positive = planMonth.balance >= 0;

  return (
    // Same treatment as TopPriorityCard (#0F2044 ground, #2ABFBF label, white
    // figure) — this is the dashboard's other "here is the number that
    // matters" card, and it read as a footnote to the snapshot while it sat on
    // white. Every colour below is the on-dark counterpart of what it replaced,
    // NOT a new palette: the muted greys become slate, the purples become the
    // light violet that survives on navy.
    <div className="mt-4 rounded-2xl p-4 sm:p-6" style={{ background: '#0F2044' }}>
      <span
        className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2"
        style={{ background: 'rgba(42,191,191,0.15)', color: '#2ABFBF' }}
      >
        {t('badge')}
      </span>

      {realCloseAmount !== null && (
        <p className="text-xs" style={{ color: '#94A3B8' }}>
          {t('closesAt', { month: monthLabel, amount: formatCurrency(realCloseAmount, locale) })}
        </p>
      )}
      {carriedInAmount !== null && (
        <p className="text-xs mb-2" style={{ color: '#64748B' }}>
          {t('carriedIn', { month: monthLabel, amount: formatCurrency(carriedInAmount, locale) })}
        </p>
      )}

      {/* Subject line — see SnapshotCard's. This is a STOCK ("how much money
          will actually be there"), so borrowed cash IS counted: it really is
          in chequing. Saying which question this answers is what stops the
          different treatment reading as an inconsistency. */}
      <p className="text-sm font-medium" style={{ color: '#2ABFBF' }}>
        {t('question')}
      </p>
      <p className="text-sm mb-1" style={{ color: '#94A3B8' }}>
        {t(planMonth.isPartialMonth ? 'labelRemainder' : 'labelFull', { month: monthLabel })}
      </p>
      {/* A negative projection must still read as bad on a dark ground — white
          would flatten it into just another figure. */}
      <p className="text-2xl font-bold" style={{ color: positive ? '#FFFFFF' : '#FCA5A5' }}>
        {formatCurrency(planMonth.balance, locale)}
      </p>

      {planMonth.cardCost.length > 0 && (
        <ul className="mt-3 space-y-1">
          {planMonth.cardCost.map((c) => (
            <li key={c.cardId} className="text-xs" style={{ color: '#C4B5FD' }}>
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
        <p className="text-sm font-semibold mt-2" style={{ color: '#C4B5FD' }}>
          {t('borrowedNote', { amount: formatCurrency(totalBorrowed, locale) })}
        </p>
      )}

      <AwaitingDatesNotice
        incomeCount={planMonth.unanchoredIncomeCount}
        expenseCount={planMonth.unanchoredExpenseCount}
        href={recurringHref}
        className="block text-xs mt-2 hover:underline"
        style={{ color: '#FCD34D' }}
      />

      {/* No Timeline link here. SnapshotCard renders one seven lines above
          this tile, to the identical URL — and its sentence ("this month's
          cash flow only, not your running balance") is what sets that link
          up, so it is the one that has to keep it. Two adjacent links to the
          same place had already drifted to different wording in both
          locales; this note stands on its own without one. */}
      <p className="text-xs mt-2" style={{ color: '#94A3B8' }}>
        {t('note')}
      </p>

      {isHorizonEnd && (
        <p className="text-xs mt-2 font-medium" style={{ color: '#C4B5FD' }}>{t('horizonEnd')}</p>
      )}
    </div>
  );
}
