'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import { formatCurrency } from '@/components/expenses/types';
import type { PlannerLine, MonthTotals } from '@/lib/plannerHelpers';

type PlannerData = {
  month: string;
  income: PlannerLine[];
  expenses: PlannerLine[];
  savings: PlannerLine[];
  totals: MonthTotals;
};

// ---------------------------------------------------------------------------
// Section component — renders one grouped block of line items
// ---------------------------------------------------------------------------

function PlannerSection({
  title,
  lines,
  sign,
  color,
  total,
  locale,
}: {
  title: string;
  lines: PlannerLine[];
  sign: '+' | '−';
  color: string;
  total: number;
  locale: string;
}) {
  return (
    <div
      className="rounded-2xl bg-white p-5"
      style={{ border: '1px solid #E5E7EB' }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
          {title}
        </h2>
        <span className="text-base font-bold" style={{ color }}>
          {sign === '+' ? '+' : '−'}{formatCurrency(total, locale)}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm" style={{ color: '#9CA3AF' }}>—</p>
      ) : (
        <div className="space-y-0.5">
          {lines.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between py-1.5 text-sm"
              style={{ borderBottom: '1px solid #F9FAFB' }}
            >
              <span style={{ color: '#374151' }}>{line.description || '—'}</span>
              <span style={{ color }}>
                {sign === '+' ? '+' : '−'}{formatCurrency(line.amount, locale)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remaining Cash card
// ---------------------------------------------------------------------------

function RemainingCashCard({ amount, locale, label }: { amount: number; locale: string; label: string }) {
  const positive = amount >= 0;
  return (
    <div
      className="rounded-2xl p-6 flex items-center justify-between"
      style={{
        background: positive ? '#F0FDF4' : '#FEF2F2',
        border: `2px solid ${positive ? '#86EFAC' : '#FECACA'}`,
      }}
    >
      <span className="text-base font-semibold" style={{ color: positive ? '#15803D' : '#B91C1C' }}>
        {label}
      </span>
      <span className="text-2xl font-bold" style={{ color: positive ? '#15803D' : '#B91C1C' }}>
        {formatCurrency(amount, locale)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlannerPage() {
  const t = useTranslations('planner');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const now = new Date();

  // Rolling 12-month selector — same UX as the expenses page
  const months: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
        month: 'short',
        year: 'numeric',
      }),
    });
  }

  const [selectedMonth, setSelectedMonth] = useState(now.toISOString().slice(0, 7));
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/planner?month=${selectedMonth}`)
      .then(async (res) => {
        if (res.status === 401) { router.push(`/${locale}/signin`); return null; }
        return res.json();
      })
      .then((d) => { if (d && !d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [selectedMonth, router, locale]);

  useEffect(() => { load(); }, [load]);

  const isEmpty =
    data &&
    data.income.length === 0 &&
    data.expenses.length === 0 &&
    data.savings.length === 0;

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>

            {/* Month tabs — same pill style as expenses page */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {months.map((mo) => (
                <button
                  key={mo.value}
                  onClick={() => setSelectedMonth(mo.value)}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer transition-all shrink-0"
                  style={{
                    background: selectedMonth === mo.value ? '#0F2044' : 'white',
                    color: selectedMonth === mo.value ? 'white' : '#6B7280',
                    border: selectedMonth === mo.value ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                  }}
                >
                  {mo.label}
                </button>
              ))}
            </div>

            {loading && (
              <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
            )}

            {!loading && data && isEmpty && (
              <p className="text-center py-12 text-sm" style={{ color: '#9CA3AF' }}>{t('empty')}</p>
            )}

            {!loading && data && !isEmpty && (
              <>
                <PlannerSection
                  title={t('income')}
                  lines={data.income}
                  sign="+"
                  color="#16A34A"
                  total={data.totals.totalIncome}
                  locale={locale}
                />
                <PlannerSection
                  title={t('expenses')}
                  lines={data.expenses}
                  sign="−"
                  color="#DC2626"
                  total={data.totals.totalExpenses}
                  locale={locale}
                />
                <PlannerSection
                  title={t('savings')}
                  lines={data.savings}
                  sign="−"
                  color="#2563EB"
                  total={data.totals.totalSavings}
                  locale={locale}
                />
                <RemainingCashCard
                  amount={data.totals.netCashFlow}
                  locale={locale}
                  label={t('remaining')}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
