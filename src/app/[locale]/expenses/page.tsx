'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import ExpenseForm from '@/components/expenses/ExpenseForm';
import SummaryTable from '@/components/expenses/SummaryTable';
import { MonthData } from '@/components/expenses/types';
import GoalSetter from '@/components/expenses/GoalSetter';

export default function ExpensesPage() {
  const t = useTranslations('expenses');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

// Rolling window: current month + 11 ahead, multi-year safe
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.toISOString().slice(0, 7));

  const months: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', year: 'numeric' }),
    });
  }

  const [data, setData] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/expenses?month=${selectedMonth}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push(`/${locale}/signin`);
          return null;
        }
        return res.json();
      })
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [selectedMonth, router, locale]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>
                {t('title')}
              </h1>
            </div>

            {/* Month tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {months.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setSelectedMonth(m.value)}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer transition-all shrink-0"
                  style={{
                    background: selectedMonth === m.value ? '#0F2044' : 'white',
                    color: selectedMonth === m.value ? 'white' : '#6B7280',
                    border: selectedMonth === m.value ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {loading && (
              <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
            )}

            {!loading && data && (
              <>
                <GoalSetter
                  month={selectedMonth}
                  currentGoal={data.cardGoal}
                  locale={locale}
                  onSaved={load}
                />
                <ExpenseForm categories={data.categories} onSaved={load} defaultDate={`${selectedMonth}-01`} />
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