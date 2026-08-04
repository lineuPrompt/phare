'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import TopPriorityCard from '@/components/dashboard/TopPriorityCard';
import SnapshotCard from '@/components/dashboard/SnapshotCard';
import SinkingFundsCard from '@/components/dashboard/SinkingFundsCard';
import GoalsCard from '@/components/dashboard/GoalsCard';
import ReviewCard from '@/components/dashboard/ReviewCard';
import EmptyState from '@/components/dashboard/EmptyState';
import { DashboardData } from '@/components/dashboard/types';
import Sidebar from '@/components/dashboard/Sidebar';
import { addMonthsToMonth } from '@/lib/goalHelpers';
import type { TimelineDay } from '@/lib/timelineHelpers';
import { buildMonthView, type UnbalancedDay } from '@/lib/timelineDisplayHelpers';
import type { PlanChainMonth } from '@/lib/planChainHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';
import SupportLine from '@/components/shared/SupportLine';

type PlanResponse = { months: PlanChainMonth[] };

type TimelineDipResponse =
  | {
      ok: true;
      balancesStartDate: string;
      openingBalance: number;
      days: TimelineDay[];
      unbalancedDays: UnbalancedDay[];
      plan: PlanResponse | null;
    }
  | { ok: false; reason: 'no_anchor' };

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';
  const { month: calendarMonth } = useBusinessToday();
  // Same 12-month rolling window (current month + 11) that Timeline's
  // materialization and bridge-ensuring cover — reusing addMonthsToMonth
  // rather than a parallel month computation keeps this one source of truth.
  const maxNavigableMonth = addMonthsToMonth(calendarMonth, 11);

  const [displayMonth, setDisplayMonth] = useState<string>(calendarMonth);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState('');

  const [hasAnchor, setHasAnchor] = useState(true);

  // Plan tile (replaces the retired single-month "Projected month-end" tile)
  // — slices the SAME single /api/timeline fetch above (real balance walk,
  // via buildMonthView, for the truthful carriedIn caption) plus its
  // includePlan=1 addition (the chained 12-month plan). One fetch, two uses.
  const [timelineDays, setTimelineDays] = useState<TimelineDay[]>([]);
  const [timelineUnbalancedDays, setTimelineUnbalancedDays] = useState<UnbalancedDay[]>([]);
  const [timelineOpeningBalance, setTimelineOpeningBalance] = useState(0);
  const [timelineBalancesStartDate, setTimelineBalancesStartDate] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts: { id: string; type: string }[] } | null) => {
        const chequing = d?.accounts.find((a) => a.type === 'chequing');
        if (!chequing) return null;
        return fetch(`/api/timeline?account=${chequing.id}&includePlan=1`).then((r) => (r.ok ? r.json() : null));
      })
      .then((d: TimelineDipResponse | null) => {
        if (!d || !d.ok) { setHasAnchor(false); return; }
        setTimelineDays(d.days);
        setTimelineUnbalancedDays(d.unbalancedDays ?? []);
        setTimelineOpeningBalance(d.openingBalance);
        setTimelineBalancesStartDate(d.balancesStartDate);
        setPlan(d.plan ?? null);
      })
      .catch(() => {});
  }, []);

  // Real carried-in balance for the viewed month — pure re-slice, not a
  // recompute (same buildCashTimeline walk already fetched above). null
  // whenever displayMonth falls outside the fetched window (e.g. a past
  // month — this fetch only covers currentMonth..currentMonth+11).
  const monthView = timelineBalancesStartDate
    ? buildMonthView(timelineDays, timelineUnbalancedDays, timelineOpeningBalance, timelineBalancesStartDate, displayMonth)
    : null;
  const carriedInAmount = monthView?.opensAt ?? null;
  // THE comparison figure for the plan invariant (plan <= real close,
  // planChainHelpers.ts's INVARIANT note) — opensAt alone left that
  // comparison invisible on screen. Same object, already computed.
  const realCloseAmount = monthView?.closesAt ?? null;

  // The chain entry for the viewed month — plan.months only ever spans
  // currentMonth..currentMonth+11 (buildPlanChain, planChainHelpers.ts), so
  // a past displayMonth simply has no entry here.
  const planMonth = plan?.months.find((m) => m.month === displayMonth) ?? null;
  const isHorizonEnd = !!(planMonth && plan && plan.months[plan.months.length - 1].month === planMonth.month);
  const isPastMonth = displayMonth < calendarMonth;

  const loadDashboard = useCallback((month: string) => {
    setLoading(true);
    setData(null);
    fetch(`/api/dashboard?month=${month}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push(`/${locale}/signin`);
          return null;
        }
        return res.json();
      })
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [router, locale]);

  // Full load: once on mount, and again after a plan regenerate (the AI
  // review/top recommendation genuinely need refreshing there). NOT run
  // again just because displayMonth changes — see the snapshot-only effect
  // below for that — otherwise every month click blanked the entire page
  // (goals, sinking funds, the AI review, all unmounted and refetched) to
  // update three numbers.
  useEffect(() => {
    loadDashboard(calendarMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDashboard]);

  // Snapshot-only month switching: /api/dashboard?snapshotOnly=1 recomputes
  // just the snapshot's figures (still via computeMonthTotals/
  // ensureBridgesForWindow — same helpers, no parallel math) and this patches
  // only those fields into `data`. goalAccounts/sinkingFunds/review are
  // untouched, so GoalsCard/SinkingFundsCard/ReviewCard never re-render and
  // the page never blanks — instant, in-place, no full reload.
  const skippedInitialSnapshotFetch = useRef(false);
  useEffect(() => {
    if (!skippedInitialSnapshotFetch.current) {
      skippedInitialSnapshotFetch.current = true; // the full load above already covers the starting month
      return;
    }
    setSnapshotLoading(true);
    fetch(`/api/dashboard?month=${displayMonth}&snapshotOnly=1`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push(`/${locale}/signin`);
          return null;
        }
        return res.json();
      })
      .then((d) => {
        if (!d || !d.hasPlan) return;
        setData((prev) => (prev ? {
          ...prev,
          month: d.month,
          summary: d.summary,
          unanchoredIncomeCount: d.unanchoredIncomeCount,
          unanchoredExpenseCount: d.unanchoredExpenseCount,
          earliestAnchorMonth: d.earliestAnchorMonth,
          cardEnvelopeRemainders: d.cardEnvelopeRemainders,
        } : prev));
      })
      .finally(() => setSnapshotLoading(false));
  }, [displayMonth, router, locale]);

  const handlePrevMonth = () => {
    const earliestAnchorMonth = data?.earliestAnchorMonth;
    if (earliestAnchorMonth && displayMonth <= earliestAnchorMonth) return;
    const [y, m] = displayMonth.split('-').map(Number);
    setDisplayMonth(m === 1
      ? `${y - 1}-12`
      : `${y}-${String(m - 1).padStart(2, '0')}`
    );
  };

  const handleNextMonth = () => {
    if (displayMonth === maxNavigableMonth) return;
    const [y, m] = displayMonth.split('-').map(Number);
    setDisplayMonth(m === 12
      ? `${y + 1}-01`
      : `${y}-${String(m + 1).padStart(2, '0')}`
    );
  };

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    setRegenerateError('');
    try {
      const res = await fetch('/api/regenerate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Regeneration failed');
      }
      // Reload dashboard so the new review + top recommendation appear.
      loadDashboard(displayMonth);
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setRegenerating(false);
    }
  }, [locale, displayMonth, loadDashboard]);

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="text-4xl mb-4 animate-pulse">🏠</div>
          <p style={{ color: '#6B7280' }}>{t('loading')}</p>
        </div>
      </main>
    );
  }

  if (!data?.hasPlan) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <EmptyState locale={locale} />
      </main>
    );
  }

  const isMaxMonth = displayMonth === maxNavigableMonth;
  const isMinMonth = data.earliestAnchorMonth ? displayMonth <= data.earliestAnchorMonth : false;

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />

        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
            <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: '#0F2044' }}>
              {t('welcome', { name: data.firstName || '' })}
            </h1>

            {/* The dip tile used to sit here, above everything. Removed
                2026-08-01: opening on "lowest point before your next
                paycheque" leads with a warning about a number, not with what
                to do about it. The dashboard now opens on the #1 priority.
                The dip itself is unchanged and still shown on Timeline
                (TimelineHeader), which is where a running-balance figure
                belongs — this was a second display of it, not its home. */}
            <div className="space-y-6">
              {data.topRecommendation && <TopPriorityCard text={data.topRecommendation} />}
              {data.summary && (
                <SnapshotCard
                  summary={data.summary}
                  locale={locale}
                  month={displayMonth}
                  onPrevMonth={handlePrevMonth}
                  onNextMonth={handleNextMonth}
                  isMaxMonth={isMaxMonth}
                  isMinMonth={isMinMonth}
                  loading={snapshotLoading}
                  unanchoredIncomeCount={data.unanchoredIncomeCount}
                  unanchoredExpenseCount={data.unanchoredExpenseCount}
                  currentMonth={calendarMonth}
                  isPastMonth={isPastMonth}
                  carriedInAmount={carriedInAmount}
                  realCloseAmount={realCloseAmount}
                  planMonth={planMonth}
                  isHorizonEnd={isHorizonEnd}
                />
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {data.goalAccounts !== undefined && (
                <GoalsCard goals={data.goalAccounts} locale={locale} />
              )}
              {data.sinkingFunds && data.sinkingFundBuffer && (
                <SinkingFundsCard
                  funds={data.sinkingFunds}
                  buffer={data.sinkingFundBuffer}
                  locale={locale}
                />
              )}
            </div>

            {data.review && <ReviewCard review={data.review} date={data.reviewDate ?? null} locale={locale} locked={data.reviewLocked ?? false} />}

            {/* Regenerate plan */}
            <div className="flex flex-col items-center gap-2 pt-2">
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-all disabled:opacity-50"
                style={{ border: '1.5px solid #0F2044', color: '#0F2044' }}
              >
                {regenerating ? t('regenerating') : t('regeneratePlan')}
              </button>
              {regenerateError && (
                <>
                  <p className="text-sm" style={{ color: '#DC2626' }}>{regenerateError}</p>
                  <SupportLine className="text-xs" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
