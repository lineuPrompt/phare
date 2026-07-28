'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import EmptyState from '@/components/dashboard/EmptyState';
import BudgetVsActualChart from '@/components/reports/BudgetVsActualChart';
import GoalProgressChart from '@/components/reports/GoalProgressChart';
import { buildBudgetVsActualRows, GoalProgressInput } from '@/lib/reportsDisplayHelpers';
import { categoryDisplayName } from '@/lib/categoryTranslations';

type ReportsResponse =
  | { hasPlan: false }
  | {
      hasPlan: true;
      month: string;
      budgetCategories: { categoryId: string; name: string; nameFr: string | null; amount: number }[];
      categoryActuals: { categoryId: string; actual: number }[];
      categories: { id: string; name: string; nameFr: string | null }[];
      goalAccounts: GoalProgressInput[];
    };

export default function ReportsPage() {
  const t = useTranslations('reports');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports')
      .then((res) => {
        if (res.status === 401) {
          router.push(`/${locale}/signin`);
          return null;
        }
        return res.json();
      })
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
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
  // shaping helper (buildBudgetVsActualRows) never touches i18n itself.
  const categoryNames = new Map(
    data.categories.map((c) => [c.id, categoryDisplayName({ name: c.name, name_fr: c.nameFr }, locale)])
  );
  const targets = data.budgetCategories.map((b) => ({
    categoryId: b.categoryId,
    name: categoryDisplayName({ name: b.name, name_fr: b.nameFr }, locale),
    amount: b.amount,
  }));
  const actualsByCategory = new Map(data.categoryActuals.map((c) => [c.categoryId, c.actual]));
  const rows = buildBudgetVsActualRows(
    targets,
    actualsByCategory,
    categoryNames,
    t('budgetVsActual.uncategorized')
  );

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="flex flex-col md:flex-row">
        <Sidebar locale={locale} />

        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
              <p className="text-sm mt-1" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
            </div>

            <BudgetVsActualChart rows={rows} locale={locale} />
            <GoalProgressChart goals={data.goalAccounts} locale={locale} />
          </div>
        </div>
      </div>
    </main>
  );
}
