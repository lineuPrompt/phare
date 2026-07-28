'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import EmptyState from '@/components/dashboard/EmptyState';
import BudgetVsActualChart from '@/components/reports/BudgetVsActualChart';
import GoalProgressChart from '@/components/reports/GoalProgressChart';
import { buildBudgetVsActualRows, buildFixedCommitmentRows, GoalProgressInput } from '@/lib/reportsDisplayHelpers';
import { categoryDisplayName } from '@/lib/categoryTranslations';
import { addMonthsToMonth } from '@/lib/goalHelpers';
import { useBusinessToday } from '@/lib/useBusinessToday';

type ReportsResponse =
  | { hasPlan: false }
  | {
      hasPlan: true;
      month: string;
      budgetCategories: { categoryId: string; name: string; nameFr: string | null; amount: number }[];
      variableActuals: { categoryId: string; actual: number }[];
      fixedActuals: { categoryId: string; actual: number }[];
      categories: { id: string; name: string; nameFr: string | null }[];
      goalAccounts: GoalProgressInput[];
    };

export default function ReportsPage() {
  const t = useTranslations('reports');
  const tNav = useTranslations('dashboard.snapshotNav');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  // Same month-navigation convention as the dashboard snapshot
  // (dashboard/page.tsx): plain client-side state, no URL reflection, a
  // 12-month-ahead cap matching the materialization window. No lower bound
  // is enforced here (unlike the dashboard, which has a real signal —
  // earliestAnchorMonth — to cap on); a past month with nothing recorded
  // simply renders its own distinct empty state instead.
  const { month: calendarMonth } = useBusinessToday();
  const maxNavigableMonth = addMonthsToMonth(calendarMonth, 11);
  const [displayMonth, setDisplayMonth] = useState<string>(calendarMonth);

  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((month: string) => {
    setLoading(true);
    fetch(`/api/reports?month=${month}`)
      .then((res) => {
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
    load(displayMonth);
  }, [displayMonth, load]);

  const handlePrevMonth = () => {
    const [y, m] = displayMonth.split('-').map(Number);
    setDisplayMonth(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    if (displayMonth === maxNavigableMonth) return;
    const [y, m] = displayMonth.split('-').map(Number);
    setDisplayMonth(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`);
  };

  if (loading && !data) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="text-4xl mb-4 animate-pulse">📊</div>
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

  // Locale name resolution happens once, here, at the edge — the pure
  // shaping helpers (buildBudgetVsActualRows/buildFixedCommitmentRows) never
  // touch i18n themselves.
  const categoryNames = new Map(
    data.categories.map((c) => [c.id, categoryDisplayName({ name: c.name, name_fr: c.nameFr }, locale)])
  );
  const targets = data.budgetCategories.map((b) => ({
    categoryId: b.categoryId,
    name: categoryDisplayName({ name: b.name, name_fr: b.nameFr }, locale),
    amount: b.amount,
  }));
  const uncategorizedLabel = t('budgetVsActual.uncategorized');
  const variableActualsByCategory = new Map(data.variableActuals.map((c) => [c.categoryId, c.actual]));
  const variableRows = buildBudgetVsActualRows(targets, variableActualsByCategory, categoryNames, uncategorizedLabel);
  const fixedActualsByCategory = new Map(data.fixedActuals.map((c) => [c.categoryId, c.actual]));
  const fixedRows = buildFixedCommitmentRows(fixedActualsByCategory, categoryNames, uncategorizedLabel);
  // Real activity check based on the RAW actuals arrays, not the merged rows
  // — a merged row exists for every budgeted category even at $0 actual, so
  // checking rows.length would never detect a genuinely empty month.
  const hasActivity = data.variableActuals.length > 0 || data.fixedActuals.length > 0;

  const [dy, dm] = displayMonth.split('-').map(Number);
  const monthLabel = new Date(dy, dm - 1, 1).toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA',
    { month: 'long', year: 'numeric' }
  );
  const isMaxMonth = displayMonth === maxNavigableMonth;

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />

        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
                <p className="text-sm mt-1" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
              </div>
              {/* Same month-nav treatment as the dashboard snapshot (‹ label
                  ›, disabled state, same i18n keys) — one pattern, not a
                  second one for this page to learn. */}
              <div className="flex items-center gap-1">
                <button
                  onClick={handlePrevMonth}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer text-lg leading-none"
                  style={{ color: '#6B7280' }}
                  aria-label={tNav('prev')}
                  title={tNav('prev')}
                >
                  ‹
                </button>
                <span
                  className="text-sm font-medium capitalize text-center"
                  style={{ color: '#374151', minWidth: '90px' }}
                >
                  {monthLabel}
                </span>
                <button
                  onClick={handleNextMonth}
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

            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
              <BudgetVsActualChart
                variableRows={variableRows}
                fixedRows={fixedRows}
                hasActivity={hasActivity}
                monthLabel={monthLabel}
                locale={locale}
              />
            </div>
            <GoalProgressChart goals={data.goalAccounts} locale={locale} />
          </div>
        </div>
      </div>
    </main>
  );
}
