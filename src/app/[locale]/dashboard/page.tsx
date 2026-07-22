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
import DipTile from '@/components/dashboard/DipTile';
import { DashboardData } from '@/components/dashboard/types';
import Sidebar from '@/components/dashboard/Sidebar';
import { addMonthsToMonth } from '@/lib/goalHelpers';
import type { DipInfo } from '@/lib/timelineHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';

type TimelineDipResponse =
  | { ok: true; dip: DipInfo | null; balancesStartDate: string; days: { date: string }[] }
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

  // Dip tile — reads the SAME /api/timeline response (and therefore the
  // same buildCashTimeline-computed `dip`) the Timeline page itself renders.
  // No parallel calculation: this is a second call site for one source of
  // truth, not a second implementation of it.
  const [dip, setDip] = useState<DipInfo | null>(null);
  const [dipWindowEnd, setDipWindowEnd] = useState<string | null>(null);
  const [hasAnchor, setHasAnchor] = useState(true);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts: { id: string; type: string }[] } | null) => {
        const chequing = d?.accounts.find((a) => a.type === 'chequing');
        if (!chequing) return null;
        return fetch(`/api/timeline?account=${chequing.id}`).then((r) => (r.ok ? r.json() : null));
      })
      .then((d: TimelineDipResponse | null) => {
        if (!d || !d.ok) { setHasAnchor(false); return; }
        setDip(d.dip);
        setDipWindowEnd(d.days.length > 0 ? d.days[d.days.length - 1].date : d.balancesStartDate);
      })
      .catch(() => {});
  }, []);

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

            {dipWindowEnd && <DipTile dip={dip} windowEndDate={dipWindowEnd} locale={locale} />}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                />
              )}
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

            {data.review && <ReviewCard review={data.review} date={data.reviewDate ?? null} locale={locale} />}

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
                <p className="text-sm" style={{ color: '#DC2626' }}>{regenerateError}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
