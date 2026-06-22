'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import CreateGoalForm from '@/components/goals/CreateGoalForm';
import TransferForm from '@/components/goals/TransferForm';
import { formatCurrency, type GoalAccount, type GoalTransfer } from '@/components/dashboard/types';

// Inline edit state for a single transfer row
type TransferEdit = {
  id: string;
  amount: string;
  date: string;
  description: string;
};

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

  // Transfer edit/delete state
  const [editing, setEditing] = useState<TransferEdit | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GoalTransfer | null>(null);
  const [saving, setSaving] = useState(false);

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

  function startEdit(tr: GoalTransfer) {
    setEditing({
      id: tr.id,
      amount: String(tr.amount),
      date: tr.date,
      description: tr.description ?? '',
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const parsed = parseFloat(editing.amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    const res = await fetch(`/api/transfers/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parsed,
        date: editing.date,
        description: editing.description.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      console.error('Failed to update transfer:', await res.json().catch(() => null));
      return;
    }
    setEditing(null);
    load();
  }

  async function doDelete(id: string) {
    await fetch(`/api/transfers/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    load();
  }

  const fmtDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short',
    });

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
                  <button onClick={() => setShowCreate(false)} className="text-sm" style={{ color: '#6B7280' }}>✕</button>
                </div>
                <CreateGoalForm onCreated={handleCreated} />
              </div>
            )}

            {loading && (
              <p className="text-center py-12" style={{ color: '#6B7280' }}>{t('loading')}</p>
            )}

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
                            <span className="text-xs" style={{ color: '#6B7280' }}>{t('saved')}</span>
                            <span className="text-xs font-semibold" style={{ color: '#6B7280' }}>{pct}%</span>
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

                      {/* Contribution history */}
                      <div className="pt-3 border-t" style={{ borderColor: '#F3F4F6' }}>
                        <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                          {t('history')}
                        </h4>

                        {goal.transfers.length === 0 && (
                          <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('noHistory')}</p>
                        )}

                        <div className="space-y-1">
                          {goal.transfers.map((tr) => {
                            const isEditingThis = editing?.id === tr.id;

                            if (isEditingThis && editing) {
                              return (
                                <div
                                  key={tr.id}
                                  className="flex flex-wrap items-center gap-2 py-2 px-2 rounded-lg"
                                  style={{ background: '#F0FDFD' }}
                                >
                                  <input
                                    type="date"
                                    value={editing.date}
                                    onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                                    className="px-2 py-1.5 rounded text-sm outline-none"
                                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                                  />
                                  <input
                                    type="text"
                                    value={editing.description}
                                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                                    placeholder={t('transfer.descriptionPlaceholder')}
                                    className="flex-1 min-w-[100px] px-2 py-1.5 rounded text-sm outline-none"
                                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editing.amount}
                                    onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                                    className="w-24 px-2 py-1.5 rounded text-sm outline-none"
                                    style={{ border: '1px solid #D1D5DB', color: '#0F2044' }}
                                  />
                                  <button
                                    onClick={saveEdit}
                                    disabled={saving || !editing.amount || parseFloat(editing.amount) <= 0}
                                    className="px-3 py-1.5 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-40"
                                    style={{ background: '#2ABFBF' }}
                                  >✓</button>
                                  <button
                                    onClick={() => setEditing(null)}
                                    className="px-3 py-1.5 rounded text-sm cursor-pointer"
                                    style={{ color: '#6B7280' }}
                                  >✕</button>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={tr.id}
                                className="flex items-center gap-3 py-1.5 px-2 group"
                                style={{ borderBottom: '1px solid #F9FAFB' }}
                              >
                                <span className="text-sm w-14 shrink-0" style={{ color: '#6B7280' }}>
                                  {fmtDate(tr.date)}
                                </span>
                                <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#0F2044' }}>
                                  {tr.description ?? '—'}
                                </span>
                                <span className="text-sm font-medium shrink-0" style={{ color: '#2ABFBF' }}>
                                  +{formatCurrency(tr.amount, locale)}
                                </span>
                                <div className="flex gap-1 shrink-0">
                                  <button
                                    onClick={() => startEdit(tr)}
                                    className="px-2 py-1 rounded text-xs cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ color: '#2ABFBF' }}
                                  >{t('editContribution')}</button>
                                  <button
                                    onClick={() => setConfirmDelete(tr)}
                                    className="px-2 py-1 rounded text-xs cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ color: '#DC2626' }}
                                  >{t('deleteContribution')}</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,32,68,0.4)' }}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" style={{ boxShadow: '0 8px 24px rgba(15,32,68,0.15)' }}>
            <p className="font-semibold mb-2" style={{ color: '#0F2044' }}>{t('confirmDeleteTitle')}</p>
            <p className="text-sm mb-5" style={{ color: '#6B7280' }}>
              {confirmDelete.description ?? formatCurrency(confirmDelete.amount, locale)}
              {' — '}
              {formatCurrency(confirmDelete.amount, locale)}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => doDelete(confirmDelete.id)}
                className="w-full py-2.5 rounded-full text-white text-sm font-medium cursor-pointer"
                style={{ background: '#DC2626' }}
              >{t('confirmDeleteBtn')}</button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="w-full py-2.5 rounded-full text-sm font-medium cursor-pointer"
                style={{ color: '#6B7280' }}
              >{t('cancelEdit')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
