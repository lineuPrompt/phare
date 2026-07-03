'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import ExpenseForm from '@/components/expenses/ExpenseForm';
import ExpenseList from '@/components/expenses/ExpenseList';
import SummaryTable from '@/components/expenses/SummaryTable';
import GoalSetter from '@/components/expenses/GoalSetter';
import MoneyFlow from '@/components/expenses/MoneyFlow';
import { MonthData } from '@/components/expenses/types';

export default function ExpensesPage() {
  const t = useTranslations('expenses');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.toISOString().slice(0, 7));
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

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
    const params = new URLSearchParams({ month: selectedMonth });
    if (selectedAccount) params.set('account', selectedAccount);
    fetch(`/api/expenses?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 401) { router.push(`/${locale}/signin`); return null; }
        return res.json();
      })
      .then((d) => {
        if (d) {
          setData(d);
          // Lock in the resolved account so tabs reflect the real selection
          if (!selectedAccount && d.selectedAccount) setSelectedAccount(d.selectedAccount.id);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedAccount, router, locale]);

  useEffect(() => { load(); }, [load]);

  const isChequing = data?.selectedAccount?.type === 'chequing';

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
            <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
            {/* Month tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {months.map((mo) => (
                <button key={mo.value} onClick={() => setSelectedMonth(mo.value)}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap cursor-pointer transition-all shrink-0"
                  style={{
                    background: selectedMonth === mo.value ? '#0F2044' : 'white',
                    color: selectedMonth === mo.value ? 'white' : '#6B7280',
                    border: selectedMonth === mo.value ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                  }}>
                  {mo.label}
                </button>
              ))}
            </div>
            {/* Account tabs */}
            {data && data.accounts.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {data.accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAccount(a.id)}
                    className="px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all"
                    style={{
                      background: data.selectedAccount?.id === a.id ? '#0F2044' : 'white',
                      color: data.selectedAccount?.id === a.id ? 'white' : '#6B7280',
                      border: data.selectedAccount?.id === a.id ? '2px solid #0F2044' : '1.5px solid #D1D5DB',
                    }}
                  >
                    {a.type === 'chequing' ? '🏦 ' : '💳 '}{a.name}
                  </button>
                ))}
              </div>
            )}

            {loading && <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>}

            {!loading && data && (
              <>
                {/* Chequing → money in/out. Card → goal + summary. */}
                {isChequing ? (
                  <MoneyFlow
                    income={data.income}
                    totalIncome={data.totalIncome}
                    totalSpent={data.totalSpent}
                    net={data.net}
                    locale={locale}
                    accounts={data.accounts}
                    onChanged={load}
                  />
                ) : (
                  <GoalSetter month={selectedMonth} accountId={data.selectedAccount?.id ?? ''} currentGoal={data.cardGoal} locale={locale} onSaved={load} />
                )}

                <ExpenseForm
                  categories={data.categories}
                  accounts={data.accounts}
                  onSaved={load}
                  defaultDate={`${selectedMonth}-01`}
                  accountId={data.selectedAccount?.id ?? null}
                />

                <ExpenseList
                  expenses={data.expenses}
                  categories={data.categories}
                  accounts={data.accounts}
                  locale={locale}
                  onChanged={load}
                />

                {!isChequing && (
                  <SummaryTable
                    summary={data.summary}
                    totalSpent={data.totalSpent}
                    cardGoal={data.cardGoal}
                    locale={locale}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}