'use client';

import { useEffect, useState, useCallback } from 'react';
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

function calendarMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Same 12-month rolling window (current month + 11) that Timeline's
// materialization and bridge-ensuring cover — reusing addMonthsToMonth
// rather than a parallel month computation keeps this one source of truth.
function maxNavigableMonth(): string {
  return addMonthsToMonth(calendarMonth(), 11);
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [displayMonth, setDisplayMonth] = useState<string>(calendarMonth);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState('');

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

  useEffect(() => {
    loadDashboard(displayMonth);
  }, [loadDashboard, displayMonth]);

  const handlePrevMonth = () => {
    const [y, m] = displayMonth.split('-').map(Number);
    setDisplayMonth(m === 1
      ? `${y - 1}-12`
      : `${y}-${String(m - 1).padStart(2, '0')}`
    );
  };

  const handleNextMonth = () => {
    if (displayMonth === maxNavigableMonth()) return;
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

  const isMaxMonth = displayMonth === maxNavigableMonth();

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />

        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>
              {t('welcome', { name: data.firstName || '' })}
            </h1>

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
                  unanchoredIncomeCount={data.unanchoredIncomeCount}
                  unanchoredExpenseCount={data.unanchoredExpenseCount}
                />
              )}
              {data.goalAccounts !== undefined && (
                <GoalsCard goals={data.goalAccounts} locale={locale} />
              )}
              {data.sinkingFunds && <SinkingFundsCard funds={data.sinkingFunds} locale={locale} />}
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
