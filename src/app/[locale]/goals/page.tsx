'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import CreateGoalForm from '@/components/goals/CreateGoalForm';
import TransferForm from '@/components/goals/TransferForm';
import { formatCurrency, type GoalAccount } from '@/components/dashboard/types';

export default function GoalsPage() {
  const t = useTranslations('goals');
  const tDash = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [goals, setGoals] = useState<GoalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [transferFor, setTransferFor] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/goals')
      .then(async (res) => {
        if (res.status === 401) { router.push(`/${locale}/signin`); return null; }
        return res.json();
      })
      .then((d) => { if (d) setGoals(d.goals ?? []); })
      .finally(() => setLoading(false));
  }, [router, locale]);

  useEffect(() => { load(); }, [load]);

  function handleCreated() {
    setShowCreate(false);
    load();
  }

  function handleTransferSaved() {
    setTransferFor(null);
    load();
  }

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="flex">
        <Sidebar locale={locale} />
        <div className="flex-1 min-w-0">
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">

            {/* Header row */}
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
              {!showCreate && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: '#0F2044', color: 'white' }}
                >
                  {t('createGoal')}
                </button>
              )}
            </div>

            {/* Create goal form */}
            {showCreate && (
              <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold" style={{ color: '#0F2044' }}>
                    {t('create.title')}
                  </h2>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="text-sm"
                    style={{ color: '#6B7280' }}
                  >
                    ✕
                  </button>
                </div>
                <CreateGoalForm onCreated={handleCreated} />
              </div>
            )}

            {/* Loading */}
            {loading && (
              <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
            )}

            {/* Empty state */}
            {!loading && goals.length === 0 && !showCreate && (
              <div className="rounded-2xl bg-white p-10 text-center" style={{ border: '1px solid #E5E7EB' }}>
                <p className="text-4xl mb-3">🎯</p>
                <p className="font-medium mb-4" style={{ color: '#0F2044' }}>{t('noGoals')}</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: '#0F2044', color: 'white' }}
                >
                  {t('create.save')}
                </button>
              </div>
            )}

            {/* Goals list */}
            {!loading && goals.length > 0 && (
              <div className="space-y-4">
                {goals.map((goal) => {
                  const pct = goal.goalTarget && goal.goalTarget > 0
                    ? Math.min(100, Math.round((goal.balance / goal.goalTarget) * 100))
                    : null;
                  const isOpen = transferFor === goal.id;

                  return (
                    <div
                      key={goal.id}
                      className="rounded-2xl bg-white p-6 space-y-4"
                      style={{ border: '1px solid #E5E7EB' }}
                    >
                      {/* Goal header */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-bold" style={{ color: '#0F2044' }}>{goal.name}</h3>
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: '#F0FDFD', color: '#2ABFBF' }}
                            >
                              {t(`type.${goal.type as 'savings' | 'tfsa' | 'rrsp'}`)}
                            </span>
                          </div>

                          {/* Balance line */}
                          <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
                            <span className="text-2xl font-bold" style={{ color: '#0F2044' }}>
                              {formatCurrency(goal.balance, locale)}
                            </span>
                            {goal.goalTarget && (
                              <span className="text-sm" style={{ color: '#6B7280' }}>
                                {t('of')} {formatCurrency(goal.goalTarget, locale)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Add money button */}
                        {!isOpen && (
                          <button
                            onClick={() => setTransferFor(goal.id)}
                            className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold"
                            style={{ background: '#2ABFBF', color: 'white' }}
                          >
                            {t('addMoney')}
                          </button>
                        )}
                      </div>

                      {/* Progress bar */}
                      {pct !== null && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs" style={{ color: '#6B7280' }}>
                              {t('saved')}
                            </span>
                            <span className="text-xs font-semibold" style={{ color: '#6B7280' }}>
                              {pct}%
                            </span>
                          </div>
                          <div className="w-full h-2.5 rounded-full" style={{ background: '#F3F4F6' }}>
                            <div
                              className="h-2.5 rounded-full transition-all"
                              style={{ width: `${pct}%`, background: '#2ABFBF' }}
                            />
                          </div>
                          {goal.goalTargetDate && (
                            <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                              {tDash('nav.goals')}:{' '}
                              {new Date(goal.goalTargetDate).toLocaleDateString(
                                locale === 'fr' ? 'fr-CA' : 'en-CA',
                                { month: 'long', year: 'numeric' }
                              )}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Inline transfer form */}
                      {isOpen && (
                        <div className="pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
                          <h4 className="text-sm font-semibold mb-3" style={{ color: '#0F2044' }}>
                            {t('transfer.title')}
                          </h4>
                          <TransferForm
                            goals={[goal]}
                            defaultGoalId={goal.id}
                            onSaved={handleTransferSaved}
                            onCancel={() => setTransferFor(null)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      </div>
    </main>
  );
}
