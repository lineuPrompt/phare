'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import ExpenseForm from '@/components/expenses/ExpenseForm';
import SummaryTable from '@/components/expenses/SummaryTable';
import { MonthData } from '@/components/expenses/types';

export default function ExpensesPage() {
  const t = useTranslations('expenses');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const currentMonth = new Date().toISOString().slice(0, 7); // '2026-06'
  const [data, setData] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/expenses?month=${currentMonth}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push(`/${locale}/signin`);
          return null;
        }
        return res.json();
      })
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [currentMonth, router, locale]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>
              {t('title')}
            </h1>

            {loading && (
              <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
            )}

            {!loading && data && (
              <>
                <ExpenseForm categories={data.categories} onSaved={load} />
                <SummaryTable
                  summary={data.summary}
                  totalSpent={data.totalSpent}
                  cardGoal={data.cardGoal}
                  locale={locale}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}